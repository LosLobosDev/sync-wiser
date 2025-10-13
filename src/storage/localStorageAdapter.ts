import type { StorageAdapter, StoredDoc } from '../types';

type LocalStorageLike = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

export type LocalStorageAdapterOptions = {
  namespace?: string;
  storage?: LocalStorageLike;
  maxUpdatesPerDoc?: number;
};

const DEFAULT_NAMESPACE = 'sync-wiser';

function toBase64(data: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function docKey(namespace: string, docId: string): string {
  return `${namespace}::${docId}`;
}

type PersistedDoc = {
  snapshot?: string;
  updates?: string[];
};

export function createLocalStorageAdapter(
  options: LocalStorageAdapterOptions = {}
): StorageAdapter {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const storage = options.storage ?? window?.localStorage;

  if (!storage) {
    throw new Error(
      'createLocalStorageAdapter requires access to window.localStorage or a compatible storage object.'
    );
  }

  const maxUpdates = options.maxUpdatesPerDoc ?? Infinity;

  const read = (docId: string): PersistedDoc | null => {
    const raw = storage.getItem(docKey(namespace, docId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PersistedDoc;
    } catch (error) {
      console.warn('[sync-wiser] Failed to parse stored doc', error);
      return null;
    }
  };

  const write = (docId: string, value: PersistedDoc) => {
    storage.setItem(docKey(namespace, docId), JSON.stringify(value));
  };

  return {
    async get(docId: string): Promise<StoredDoc | null> {
      const persisted = read(docId);
      if (!persisted) return null;

      const snapshot = persisted.snapshot
        ? fromBase64(persisted.snapshot)
        : null;
      const updates = (persisted.updates ?? []).map((encoded) =>
        fromBase64(encoded)
      );

      if (!snapshot && updates.length === 0) return null;

      return {
        snapshot,
        updates,
      };
    },

    async setSnapshot(docId: string, snapshot: Uint8Array): Promise<void> {
      const persisted = read(docId) ?? {};
      persisted.snapshot = toBase64(snapshot);
      write(docId, persisted);
    },

    async appendUpdate(docId: string, update: Uint8Array): Promise<void> {
      const persisted = read(docId) ?? {};
      const updates = persisted.updates ?? [];
      updates.push(toBase64(update));

      if (updates.length > maxUpdates) {
        updates.splice(0, updates.length - maxUpdates);
      }

      persisted.updates = updates;
      write(docId, persisted);
    },

    async remove(docId: string): Promise<void> {
      storage.removeItem(docKey(namespace, docId));
    },
  };
}
