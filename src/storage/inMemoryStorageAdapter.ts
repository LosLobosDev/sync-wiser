export type StoredDoc = {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
};

export type StorageAdapter = {
  get(docId: string): Promise<StoredDoc | null>;
  setSnapshot(docId: string, snapshot: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  remove(docId: string): Promise<void>;
};

export function createInMemoryStorageAdapter(): StorageAdapter {
  const snapshots = new Map<string, Uint8Array>();
  const updates = new Map<string, Uint8Array[]>();

  return {
    async get(docId: string): Promise<StoredDoc | null> {
      const snapshot = snapshots.get(docId) ?? null;
      const storedUpdates = updates.get(docId) ?? [];

      if (!snapshot && storedUpdates.length === 0) {
        return null;
      }

      return {
        snapshot: snapshot ? snapshot.slice() : null,
        updates: storedUpdates.map((update) => update.slice()),
      };
    },
    async setSnapshot(docId: string, snapshot: Uint8Array): Promise<void> {
      snapshots.set(docId, snapshot.slice());
    },
    async appendUpdate(docId: string, update: Uint8Array): Promise<void> {
      const pendingUpdates = updates.get(docId);
      const cloned = update.slice();

      if (pendingUpdates) {
        pendingUpdates.push(cloned);
      } else {
        updates.set(docId, [cloned]);
      }
    },
    async remove(docId: string): Promise<void> {
      snapshots.delete(docId);
      updates.delete(docId);
    },
  };
}
