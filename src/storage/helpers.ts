import type { StorageAdapter, StoredDoc, StoredSnapshot } from '../types';

type StoredDocAccumulator = {
  snapshot?: Uint8Array | null;
  updates?: Uint8Array[];
  pendingSync?: Uint8Array[];
  snapshotGeneration?: number;
  syncedSnapshotGeneration?: number;
};

function cloneSnapshot(record: StoredSnapshot | null | undefined) {
  if (!record) return record;
  return {
    snapshot: record.snapshot ? record.snapshot.slice() : null,
    snapshotGeneration: record.snapshotGeneration,
    syncedSnapshotGeneration: record.syncedSnapshotGeneration,
  };
}

function cloneUpdates(updates: Uint8Array[] | null | undefined): Uint8Array[] | null | undefined {
  if (!updates) return updates;
  return updates.map((update) => update.slice());
}

export async function assembleStoredDoc(
  adapter: StorageAdapter,
  docId: string
): Promise<StoredDoc | null> {
  const parts: StoredDocAccumulator = {};

  if (!adapter.getUpdates) {
    throw new Error(
      '[sync-wiser] StorageAdapter must implement getUpdates(docId) to hydrate documents.'
    );
  }

  const snapshotRecord = adapter.getSnapshot
    ? cloneSnapshot(await adapter.getSnapshot(docId))
    : undefined;

  if (snapshotRecord === null) {
    return null;
  }
  if (snapshotRecord !== undefined) {
    parts.snapshot = snapshotRecord.snapshot;
    parts.snapshotGeneration = snapshotRecord.snapshotGeneration;
    parts.syncedSnapshotGeneration = snapshotRecord.syncedSnapshotGeneration;
  }

  const updates = cloneUpdates(await adapter.getUpdates(docId));
  if (updates === null) {
    return null;
  }
  parts.updates = updates ?? [];

  const pendingSync = adapter.getPendingSync
    ? cloneUpdates(await adapter.getPendingSync(docId))
    : undefined;
  if (pendingSync === null) {
    return null;
  }
  if (pendingSync !== undefined) {
    parts.pendingSync = pendingSync;
  }

  if (parts.snapshot === undefined || parts.snapshot === null) {
    parts.snapshot = null;
  }
  if (!parts.pendingSync) {
    parts.pendingSync = [];
  }

  const hasData =
    parts.snapshot !== null ||
    (parts.updates?.length ?? 0) > 0 ||
    (parts.pendingSync?.length ?? 0) > 0 ||
    typeof parts.snapshotGeneration === 'number' ||
    typeof parts.syncedSnapshotGeneration === 'number';

  if (!hasData) {
    return null;
  }

  return {
    snapshot: parts.snapshot,
    updates: parts.updates ?? [],
    pendingSync: parts.pendingSync,
    snapshotGeneration: parts.snapshotGeneration,
    syncedSnapshotGeneration: parts.syncedSnapshotGeneration,
  };
}
