import type { StorageAdapter, StoredDoc } from '../types';
export function createInMemoryStorageAdapter(): StorageAdapter {
  const snapshots = new Map<string, Uint8Array>();
  const updates = new Map<string, Uint8Array[]>();
  const pending = new Map<string, Uint8Array[]>();
  const metadata = new Map<
    string,
    { generation: number; syncedGeneration: number }
  >();

  const hasDoc = (docId: string): boolean =>
    snapshots.has(docId) || updates.has(docId) || pending.has(docId);

  const adapter: StorageAdapter = {
    async getSnapshot(docId: string) {
      if (!hasDoc(docId)) {
        return null;
      }
      const snapshot = snapshots.get(docId) ?? null;
      const meta = metadata.get(docId) ?? {
        generation: 0,
        syncedGeneration: 0,
      };
      return {
        snapshot: snapshot ? snapshot.slice() : null,
        snapshotGeneration: meta.generation,
        syncedSnapshotGeneration: meta.syncedGeneration,
      };
    },
    async getUpdates(docId: string) {
      if (!hasDoc(docId)) {
        return null;
      }
      const storedUpdates = updates.get(docId) ?? [];
      return storedUpdates.map((update) => update.slice());
    },
    async getPendingSync(docId: string) {
      if (!hasDoc(docId)) {
        return null;
      }
      const pendingUpdates = pending.get(docId) ?? [];
      return pendingUpdates.map((update) => update.slice());
    },
    async setSnapshot(docId: string, snapshot: Uint8Array): Promise<void> {
      snapshots.set(docId, snapshot.slice());
      const current = metadata.get(docId) ?? {
        generation: 0,
        syncedGeneration: 0,
      };
      const nextGeneration = current.generation + 1;
      metadata.set(docId, {
        generation: nextGeneration,
        syncedGeneration: Math.min(current.syncedGeneration, nextGeneration),
      });
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
    async markSnapshotSynced(docId: string, generation: number) {
      const current = metadata.get(docId);
      if (!current) {
        metadata.set(docId, {
          generation,
          syncedGeneration: generation,
        });
        return;
      }
      metadata.set(docId, {
        generation: Math.max(current.generation, generation),
        syncedGeneration: Math.min(
          Math.max(current.syncedGeneration, generation),
          Math.max(current.generation, generation)
        ),
      });
    },
    async clearPendingSync(docId: string) {
      pending.delete(docId);
    },
    async remove(docId: string): Promise<void> {
      snapshots.delete(docId);
      updates.delete(docId);
      pending.delete(docId);
      metadata.delete(docId);
    },
  };

  return adapter as StorageAdapter & {
    get(docId: string): Promise<StoredDoc | null>;
  };
}
