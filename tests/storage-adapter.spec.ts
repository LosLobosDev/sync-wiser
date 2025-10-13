import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryStorageAdapter } from '../src/storage/inMemoryStorageAdapter';

describe('InMemoryStorageAdapter', () => {
  let storage = createInMemoryStorageAdapter();

  beforeEach(() => {
    storage = createInMemoryStorageAdapter();
  });

  it('returns null when a doc is unknown', async () => {
    await expect(storage.get('missing-doc')).resolves.toBeNull();
  });

  it('stores snapshots without leaking references', async () => {
    const docId = 'shopping-list';
    const snapshot = Uint8Array.from([1, 2, 3]);

    await storage.setSnapshot(docId, snapshot);
    snapshot[0] = 99;

    const stored = await storage.get(docId);
    expect(stored).not.toBeNull();
    expect(stored?.snapshot).toEqual(Uint8Array.from([1, 2, 3]));
    expect(stored?.updates).toEqual([]);

    // Mutating the returned snapshot should not affect subsequent reads.
    stored!.snapshot![0] = 77;
    const reread = await storage.get(docId);
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

    const stored = await storage.get(docId);
    expect(stored).not.toBeNull();
    expect(stored?.snapshot).toBeNull();
    expect(stored?.updates).toEqual([
      Uint8Array.from([10]),
      Uint8Array.from([20]),
    ]);

    // Mutating returned updates should not leak back into storage.
    stored!.updates[0][0] = 42;
    const reread = await storage.get(docId);
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
    await storage.setSnapshot(docId, snapshot);

    const stored = await storage.get(docId);
    expect(stored?.snapshot).toEqual(Uint8Array.from([5]));
    expect(stored?.updates).toEqual([Uint8Array.from([1])]);
  });

  it('removes snapshots and updates when remove is called', async () => {
    const docId = 'shopping-list';
    await storage.setSnapshot(docId, Uint8Array.from([1]));
    await storage.appendUpdate(docId, Uint8Array.from([2]));

    await storage.remove(docId);

    await expect(storage.get(docId)).resolves.toBeNull();
  });
});
