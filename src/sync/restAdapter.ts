import * as Y from 'yjs';
import type {
  SyncAdapter,
  SyncPullOptions,
  SyncPushOptions,
} from '../types';

type LastSyncedAccessor = {
  get(docId: string): Promise<string | null>;
  set(docId: string, value: string | null): Promise<void>;
};

type PullContext = {
  docId: string;
  lastSynced: string | null;
  stateVector?: Uint8Array;
  options?: SyncPullOptions;
};

type PushContext = {
  docId: string;
  lastSynced: string | null;
  update: Uint8Array;
  isSnapshot: boolean;
  options?: SyncPushOptions;
};

type PullRequestBuilder = (input: {
  baseUrl: string;
  headers: Record<string, string>;
  context: PullContext;
  encode: (data: Uint8Array) => unknown;
}) =>
  | { url: string; init?: RequestInit }
  | Promise<{ url: string; init?: RequestInit }>;

type PullResponseParser = (input: {
  response: Response;
  context: PullContext;
  decode: (payload: unknown) => Uint8Array;
}) =>
  | PullParseResult
  | Promise<PullParseResult>;

type PullParseResult =
  | {
      updates: Uint8Array[];
      snapshot?: Uint8Array | null;
      dateLastSynced: string | null;
    }
  | null;

type PushRequestBuilder = (input: {
  baseUrl: string;
  headers: Record<string, string>;
  context: PushContext;
  encode: (data: Uint8Array) => unknown;
}) =>
  | { url: string; init?: RequestInit }
  | Promise<{ url: string; init?: RequestInit }>;

type PushResponseParser = (input: {
  response: Response;
  context: PushContext;
}) =>
  | { dateLastSynced: string | null }
  | null
  | Promise<{ dateLastSynced: string | null } | null>;

export type RestSyncAdapterOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  encodeUpdate?: (update: Uint8Array) => unknown;
  decodeUpdate?: (payload: unknown) => Uint8Array;
  getLastSynced?: (docId: string) => Promise<string | null>;
  setLastSynced?: (docId: string, value: string | null) => Promise<void>;
  buildPullRequest?: PullRequestBuilder;
  parsePullResponse?: PullResponseParser;
  buildPushRequest?: PushRequestBuilder;
  parsePushResponse?: PushResponseParser;
  onError?: (error: unknown) => void;
};

export function createRestSyncAdapter(
  options: RestSyncAdapterOptions
): SyncAdapter {
  const {
    baseUrl,
    fetch: fetchImpl = typeof fetch === 'function' ? fetch : undefined,
    headers: baseHeaders,
    encodeUpdate = defaultEncodeUpdate,
    decodeUpdate = defaultDecodeUpdate,
    getLastSynced,
    setLastSynced,
    buildPullRequest = defaultBuildPullRequest,
    parsePullResponse = defaultParsePullResponse,
    buildPushRequest = defaultBuildPushRequest,
    parsePushResponse = defaultParsePushResponse,
    onError,
  } = options;

  if (!fetchImpl) {
    throw new Error(
      '[sync-wiser][rest-sync] A fetch implementation must be provided (global fetch is not available).'
    );
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const headers = { ...(baseHeaders ?? {}) };
  if (!('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const memoryLastSynced = new Map<string, string | null>();
  const accessor: LastSyncedAccessor = {
    async get(docId) {
      if (getLastSynced) return getLastSynced(docId);
      return memoryLastSynced.get(docId) ?? null;
    },
    async set(docId, value) {
      if (setLastSynced) {
        await setLastSynced(docId, value);
        return;
      }
      memoryLastSynced.set(docId, value);
    },
  };

  const reportError = (error: unknown) => {
    if (onError) {
      onError(error);
      return;
    }
    console.error('[sync-wiser][rest-sync]', error);
  };

  const pull: SyncAdapter['pull'] = async (
    docId,
    stateVector,
    pullOptions
  ) => {
    const lastSynced = await accessor.get(docId);
    const context: PullContext = {
      docId,
      lastSynced,
      stateVector: stateVector ?? undefined,
      options: pullOptions,
    };

    const { url, init } = await buildPullRequest({
      baseUrl: normalizedBase,
      headers,
      context,
      encode: encodeUpdate,
    });

    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      ...init,
    });

    if (!response.ok) {
      const error = new Error(
        `[sync-wiser][rest-sync] Pull request failed with status ${response.status}`
      );
      reportError(error);
      throw error;
    }

    const parsed = await parsePullResponse({
      response,
      context,
      decode: decodeUpdate,
    });

    if (!parsed) {
      return null;
    }

    await accessor.set(docId, parsed.dateLastSynced ?? null);

    const chunks: Uint8Array[] = [];
    if (parsed.snapshot) {
      chunks.push(parsed.snapshot);
    }
    if (parsed.updates?.length) {
      chunks.push(...parsed.updates);
    }

    if (chunks.length === 0) {
      return null;
    }

    if (chunks.length === 1) {
      return chunks[0]!;
    }

    return Y.mergeUpdates(chunks);
  };

  const push: SyncAdapter['push'] = async (docId, update, pushOptions) => {
    const lastSynced = await accessor.get(docId);
    const context: PushContext = {
      docId,
      lastSynced,
      update,
      isSnapshot: pushOptions?.isSnapshot ?? false,
      options: pushOptions,
    };

    const { url, init } = await buildPushRequest({
      baseUrl: normalizedBase,
      headers,
      context,
      encode: encodeUpdate,
    });

    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      ...init,
    });

    if (!response.ok) {
      const error = new Error(
        `[sync-wiser][rest-sync] Push request failed with status ${response.status}`
      );
      reportError(error);
      throw error;
    }

    const parsed = await parsePushResponse({
      response,
      context,
    });

    if (parsed?.dateLastSynced !== undefined) {
      await accessor.set(docId, parsed.dateLastSynced);
    }
  };

  return {
    pull,
    push,
  };
}

function defaultEncodeUpdate(update: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(update).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < update.length; i += 1) {
    binary += String.fromCharCode(update[i]!);
  }
  return btoa(binary);
}

function defaultDecodeUpdate(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) {
    return payload.slice();
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload.slice(0));
  }
  if (Array.isArray(payload)) {
    return Uint8Array.from(payload);
  }
  if (typeof payload === 'string') {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(payload, 'base64'));
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new TypeError(
    '[sync-wiser][rest-sync] Unsupported payload format; provide a custom decodeUpdate()'
  );
}

async function defaultParsePullResponse({
  response,
  context,
  decode,
}: Parameters<PullResponseParser>[0]): Promise<PullParseResult> {
  const json = await response.json();
  if (!json || !Array.isArray(json.documents)) {
    return null;
  }
  const entry = json.documents.find(
    (doc: any) => doc?.id === context.docId
  );
  if (!entry) {
    return null;
  }

  const updates: Uint8Array[] = Array.isArray(entry.updates)
    ? entry.updates.map((item: unknown) => decode(item))
    : [];

  const snapshot =
    entry.snapshot !== undefined && entry.snapshot !== null
      ? decode(entry.snapshot)
      : undefined;

  return {
    updates,
    snapshot,
    dateLastSynced:
      typeof entry.dateLastSynced === 'string' ? entry.dateLastSynced : null,
  };
}

function defaultBuildPullRequest({
  baseUrl,
  headers,
  context,
  encode,
}: Parameters<PullRequestBuilder>[0]): { url: string; init: RequestInit } {
  const url = `${baseUrl}/pull`;
  const document: Record<string, unknown> = {
    id: context.docId,
    lastSynced: context.lastSynced,
    requestSnapshot: context.options?.requestSnapshot ?? false,
  };

  if (context.stateVector) {
    document.stateVector = encode(context.stateVector);
  }

  return {
    url,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({ documents: [document] }),
    },
  };
}

async function defaultParsePushResponse({
  response,
  context,
}: Parameters<PushResponseParser>[0]): Promise<{
  dateLastSynced: string | null;
} | null> {
  const json = await response.json();
  if (!json || !Array.isArray(json.documents)) {
    return null;
  }
  const entry = json.documents.find(
    (doc: any) => doc?.id === context.docId
  );
  if (!entry) {
    return null;
  }
  return {
    dateLastSynced:
      typeof entry.dateLastSynced === 'string' ? entry.dateLastSynced : null,
  };
}

function defaultBuildPushRequest({
  baseUrl,
  headers,
  context,
  encode,
}: Parameters<PushRequestBuilder>[0]): { url: string; init: RequestInit } {
  const url = `${baseUrl}/push`;
  const document = {
    id: context.docId,
    update: encode(context.update),
    isSnapshot: context.isSnapshot,
    lastSynced: context.lastSynced,
  };

  return {
    url,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({ documents: [document] }),
    },
  };
}
