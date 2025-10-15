import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryStorageAdapter } from '../src/storage/inMemoryStorageAdapter';
import { assembleStoredDoc } from '../src/storage/helpers';
import type { StorageAdapter } from '../src/types';

function expectDefined<T>(value: T | undefined, name: string): T {
  expect(value, `${name} should be defined`).toBeDefined();
  if (value === undefined) {
    throw new Error(`Expected ${name} to be defined`);
  }
  return value;
}

describe('InMemoryStorageAdapter', () => {
  let storage = createInMemoryStorageAdapter();

  beforeEach(() => {
    storage = createInMemoryStorageAdapter();
  });

  it('returns null when a doc is unknown', async () => {
    await expect(assembleStoredDoc(storage, 'missing-doc')).resolves.toBeNull();
  });

  it('stores snapshots without leaking references', async () => {
    const docId = 'shopping-list';
    const snapshot = Uint8Array.from([1, 2, 3]);

    const setSnapshot = expectDefined(storage.setSnapshot, 'setSnapshot');
    await setSnapshot(docId, snapshot);
    snapshot[0] = 99;

    const stored = await assembleStoredDoc(storage, docId);
    expect(stored).not.toBeNull();
    expect(stored?.snapshot).toEqual(Uint8Array.from([1, 2, 3]));
    expect(stored?.updates).toEqual([]);

    // Mutating the returned snapshot should not affect subsequent reads.
    stored!.snapshot![0] = 77;
    const reread = await assembleStoredDoc(storage, docId);
    expect(reread?.snapshot).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('queues updates in order and clones stored values', async () => {
    const docId = 'shopping-list';
    const updateA = Uint8Array.from([10]);
    const updateB = Uint8Array.from([20]);

    await storage.appendUpdate(docId, updateA);
    await storage.appendUpdate(docId, updateB);

    // Mutate original buffers to confirm deep copies are stored.
    updateA[0] = 99;
    updateB[0] = 88;

    const stored = await assembleStoredDoc(storage, docId);
    expect(stored).not.toBeNull();
    expect(stored?.snapshot).toBeNull();
    expect(stored?.updates).toEqual([
      Uint8Array.from([10]),
      Uint8Array.from([20]),
    ]);

    // Mutating returned updates should not leak back into storage.
    stored!.updates[0][0] = 42;
    const reread = await assembleStoredDoc(storage, docId);
    expect(reread?.updates).toEqual([
      Uint8Array.from([10]),
      Uint8Array.from([20]),
    ]);
  });

  it('retains updates when a snapshot is set later', async () => {
    const docId = 'shopping-list';
    const update = Uint8Array.from([1]);
    const snapshot = Uint8Array.from([5]);

    await storage.appendUpdate(docId, update);
    const setSnapshot = expectDefined(storage.setSnapshot, 'setSnapshot');
    await setSnapshot(docId, snapshot);

    const stored = await assembleStoredDoc(storage, docId);
    expect(stored?.snapshot).toEqual(Uint8Array.from([5]));
    expect(stored?.updates).toEqual([Uint8Array.from([1])]);
  });

  it('removes snapshots and updates when remove is called', async () => {
    const docId = 'shopping-list';
    const setSnapshot = expectDefined(storage.setSnapshot, 'setSnapshot');
    await setSnapshot(docId, Uint8Array.from([1]));
    await storage.appendUpdate(docId, Uint8Array.from([2]));

    await storage.remove(docId);

    await expect(assembleStoredDoc(storage, docId)).resolves.toBeNull();
  });
});

describe('assembleStoredDoc', () => {
  it('combines granular getters into a stored doc', async () => {
    const snapshot = Uint8Array.from([1, 2, 3]);
    const update = Uint8Array.from([4, 5]);
    const pending = Uint8Array.from([9]);

    const storage = {
      async getSnapshot() {
        return {
          snapshot,
          snapshotGeneration: 3,
          syncedSnapshotGeneration: 1,
        };
      },
      async getUpdates() {
        return [update];
      },
      async getPendingSync() {
        return [pending];
      },
      async setSnapshot() {
        /* noop */
      },
      async appendUpdate() {
        /* noop */
      },
      async remove() {
        /* noop */
      },
    };

    const stored = await assembleStoredDoc(
      storage as StorageAdapter,
      'doc-id'
    );

    expect(stored).not.toBeNull();
    expect(stored?.snapshot).toEqual(snapshot);
    expect(stored?.updates).toEqual([update]);
    expect(stored?.pendingSync).toEqual([pending]);
    expect(stored?.snapshotGeneration).toBe(3);
    expect(stored?.syncedSnapshotGeneration).toBe(1);

    if (!stored) throw new Error('expected stored doc');
    stored.snapshot![0] = 99;
    stored.updates[0][0] = 88;
    stored.pendingSync![0][0] = 77;

    const secondRead = await assembleStoredDoc(
      storage as StorageAdapter,
      'doc-id'
    );

    expect(secondRead?.snapshot).toEqual(snapshot);
    expect(secondRead?.updates?.[0]).toEqual(update);
    expect(secondRead?.pendingSync?.[0]).toEqual(pending);
  });

  it('throws a descriptive error when getUpdates is missing', async () => {
    const storage = {
      async setSnapshot() {
        /* noop */
      },
      async appendUpdate() {
        /* noop */
      },
      async remove() {
        /* noop */
      },
    };

    await expect(
      assembleStoredDoc(storage as unknown as StorageAdapter, 'doc-id')
    ).rejects.toThrow(/getUpdates/i);
  });
});
