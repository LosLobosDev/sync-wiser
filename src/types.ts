import type * as Y from 'yjs';

export type StoredDoc = {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
  pendingSync?: Uint8Array[];
};

export type StorageAdapter = {
  get(docId: string): Promise<StoredDoc | null>;
  setSnapshot(docId: string, snapshot: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  remove(docId: string): Promise<void>;
  markPendingSync?(docId: string, updates: Uint8Array[]): Promise<void>;
  clearPendingSync?(docId: string): Promise<void>;
};

export type SyncAdapter = {
  pull(docId: string, stateVector?: Uint8Array): Promise<Uint8Array | null>;
  push(docId: string, update: Uint8Array): Promise<void>;
};

export type RealtimeAdapter = {
  subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void;
  publish(docId: string, update: Uint8Array): Promise<void>;
};

export type CodecAdapter = {
  encode(update: Uint8Array): Uint8Array;
  decode(update: Uint8Array): Uint8Array;
};

export type Policies = {
  gc?: boolean;
  snapshotEvery?: {
    updates?: number;
    bytes?: number;
  };
  pullBeforePush?: boolean;
};

export type CacheOptions = {
  maxDocs?: number;
};

export type WiserConfig = {
  storage: StorageAdapter;
  sync?: SyncAdapter;
  realtime?: RealtimeAdapter;
  codec?: CodecAdapter;
  policies?: Policies;
  cache?: CacheOptions;
  logger?: {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
  onError?: (error: unknown) => void;
};

export type YjsModelFactory<
  TShape extends Record<string, Y.YEvent<any>>
> = (helpers: YHelpers) => TShape;

export type YHelpers = {
  text(): Y.Text;
  map<T>(): Y.Map<T>;
  array<T>(): Y.Array<T>;
  xmlText(): Y.XmlText;
  xmlElement(name?: string): Y.XmlElement;
  xmlFragment(): Y.XmlFragment;
};

export type WiserModel<TShape extends Record<string, unknown>> = {
  name: string;
  instantiate(doc?: Y.Doc): { doc: Y.Doc; data: TShape };
  ensureStructure(doc: Y.Doc): TShape;
};
