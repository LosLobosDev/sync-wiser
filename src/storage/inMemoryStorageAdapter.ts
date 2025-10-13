import type { StorageAdapter, StoredDoc } from '../types';

export function createInMemoryStorageAdapter(): StorageAdapter {
  const snapshots = new Map<string, Uint8Array>();
  const updates = new Map<string, Uint8Array[]>();
  const pending = new Map<string, Uint8Array[]>();

  return {
    async get(docId: string): Promise<StoredDoc | null> {
      const snapshot = snapshots.get(docId) ?? null;
      const storedUpdates = updates.get(docId) ?? [];
      const pendingUpdates = pending.get(docId) ?? [];

      if (!snapshot && storedUpdates.length === 0 && pendingUpdates.length === 0) {
        return null;
      }

      return {
        snapshot: snapshot ? snapshot.slice() : null,
        updates: storedUpdates.map((update) => update.slice()),
        pendingSync: pendingUpdates.map((update) => update.slice()),
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
    async markPendingSync(docId: string, updatesToMark: Uint8Array[]) {
      pending.set(
        docId,
        updatesToMark.map((update) => update.slice())
      );
    },
    async clearPendingSync(docId: string) {
      pending.delete(docId);
    },
    async remove(docId: string): Promise<void> {
      snapshots.delete(docId);
      updates.delete(docId);
      pending.delete(docId);
    },
  };
}
