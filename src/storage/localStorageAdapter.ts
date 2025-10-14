import type { StorageAdapter, StoredDoc } from '../types';
import { assembleStoredDoc } from './helpers';

type LocalStorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

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
  const base64Encoder =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as typeof globalThis & { btoa?: typeof btoa }).btoa ===
      'function'
      ? (globalThis as typeof globalThis & { btoa: typeof btoa }).btoa
      : null;
  if (base64Encoder) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return base64Encoder(binary);
  }
  throw new Error(
    'createLocalStorageAdapter requires a base64 encoder (Buffer or globalThis.btoa).'
  );
}

function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  const base64Decoder =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as typeof globalThis & { atob?: typeof atob }).atob ===
      'function'
      ? (globalThis as typeof globalThis & { atob: typeof atob }).atob
      : null;
  if (base64Decoder) {
    const binary = base64Decoder(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error(
    'createLocalStorageAdapter requires a base64 decoder (Buffer or globalThis.atob).'
  );
}

function docKey(namespace: string, docId: string): string {
  return `${namespace}::${docId}`;
}

type PersistedDoc = {
  snapshot?: string;
  updates?: string[];
  pendingSync?: string[];
  snapshotGeneration?: number;
  syncedSnapshotGeneration?: number;
};

export function createLocalStorageAdapter(
  options: LocalStorageAdapterOptions = {}
): StorageAdapter & { get(docId: string): Promise<StoredDoc | null> } {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const storage =
    options.storage ??
    (typeof globalThis !== 'undefined'
      ? ((globalThis as typeof globalThis & {
          localStorage?: LocalStorageLike;
        }).localStorage as LocalStorageLike | undefined)
      : undefined);

  if (!storage) {
    throw new Error(
      'createLocalStorageAdapter requires access to globalThis.localStorage or a compatible storage object.'
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

  const hasDoc = (docId: string): boolean => {
    const persisted = read(docId);
    if (!persisted) return false;
    return Boolean(
      persisted.snapshot ||
        (persisted.updates && persisted.updates.length > 0) ||
        (persisted.pendingSync && persisted.pendingSync.length > 0)
    );
  };

  const adapter: StorageAdapter = {
    async getSnapshot(docId: string) {
      const persisted = read(docId);
      if (!persisted) return null;
      const snapshot = persisted.snapshot
        ? fromBase64(persisted.snapshot)
        : null;
      return {
        snapshot,
        snapshotGeneration: persisted.snapshotGeneration ?? 0,
        syncedSnapshotGeneration: persisted.syncedSnapshotGeneration ?? 0,
      };
    },
    async getUpdates(docId: string) {
      if (!hasDoc(docId)) return null;
      const persisted = read(docId);
      if (!persisted) return null;
      const updates = persisted.updates ?? [];
      return updates.map((encoded) => fromBase64(encoded));
    },
    async getPendingSync(docId: string) {
      if (!hasDoc(docId)) return null;
      const persisted = read(docId);
      if (!persisted) return null;
      const pendingSync = persisted.pendingSync ?? [];
      return pendingSync.map((encoded) => fromBase64(encoded));
    },
    async setSnapshot(docId: string, snapshot: Uint8Array): Promise<void> {
      const persisted = read(docId) ?? {};
      const nextGeneration = (persisted.snapshotGeneration ?? 0) + 1;
      persisted.snapshot = toBase64(snapshot);
      persisted.snapshotGeneration = nextGeneration;
      const previousSynced = persisted.syncedSnapshotGeneration ?? 0;
      persisted.syncedSnapshotGeneration = Math.min(previousSynced, nextGeneration);
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

    async markPendingSync(docId: string, updatesToMark: Uint8Array[]) {
      const persisted = read(docId) ?? {};
      persisted.pendingSync = updatesToMark.map((update) => toBase64(update));
      write(docId, persisted);
    },

    async markSnapshotSynced(docId: string, generation: number) {
      const persisted = read(docId) ?? {};
      const currentGeneration = persisted.snapshotGeneration ?? generation;
      persisted.snapshotGeneration = Math.max(currentGeneration, generation);
      const currentSynced = persisted.syncedSnapshotGeneration ?? 0;
      const updatedSynced = Math.min(
        Math.max(currentSynced, generation),
        persisted.snapshotGeneration
      );
      persisted.syncedSnapshotGeneration = updatedSynced;
      write(docId, persisted);
    },

    async clearPendingSync(docId: string) {
      const persisted = read(docId);
      if (!persisted) return;
      delete persisted.pendingSync;
      write(docId, persisted);
    },

    async remove(docId: string): Promise<void> {
      storage.removeItem(docKey(namespace, docId));
    },
  };

  return adapter;
}
