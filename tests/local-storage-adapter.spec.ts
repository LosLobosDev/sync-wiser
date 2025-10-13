import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalStorageAdapter } from '../src/storage/localStorageAdapter';

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

type MockStorage = ReturnType<typeof createMockStorage>;

describe('createLocalStorageAdapter', () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it('returns null for unknown docs', async () => {
    const adapter = createLocalStorageAdapter({ storage });
    const stored = await adapter.getUpdates('missing');
    expect(stored).toBeNull();
  });

  it('persists snapshots without leaking references', async () => {
    const adapter = createLocalStorageAdapter({ storage });
    const docId = 'doc-1';
    const snapshot = Uint8Array.from([1, 2, 3]);

    await adapter.setSnapshot!(docId, snapshot);
    snapshot[0] = 99;


    expect(await adapter.getSnapshot!(docId)).toEqual({ 
      snapshot:Uint8Array.from([1, 2, 3]), 
      snapshotGeneration: 1,
      syncedSnapshotGeneration: 0
    });
    expect(await adapter.getUpdates(docId)).toEqual([]);

    snapshot![1] = 77;
    const reread = await adapter.getSnapshot!(docId);
    expect(reread?.snapshot).toEqual(Uint8Array.from([1, 2, 3]) );
  });

  it('queues updates in order and clones values', async () => {
    const adapter = createLocalStorageAdapter({ storage });
    const docId = 'doc-queue';
    const updateA = Uint8Array.from([10]);
    const updateB = Uint8Array.from([20]);

    await adapter.appendUpdate(docId, updateA);
    await adapter.appendUpdate(docId, updateB);

    updateA[0] = 42;
    updateB[0] = 84;

    const updates = await adapter.getUpdates(docId);
    expect(updates).toEqual([
      Uint8Array.from([10]),
      Uint8Array.from([20]),
    ]);

    updates[0][0] = 99;
    const reread = await adapter.getUpdates(docId);
    expect(reread[0]).toEqual(Uint8Array.from([10]));
  });

  it('trims update history when maxUpdatesPerDoc is exceeded', async () => {
    const mock = createMockStorage();
    const adapter = createLocalStorageAdapter({
      storage: mock,
      maxUpdatesPerDoc: 2,
    });

    await adapter.appendUpdate('doc-trim', Uint8Array.from([1]));
    await adapter.appendUpdate('doc-trim', Uint8Array.from([2]));
    await adapter.appendUpdate('doc-trim', Uint8Array.from([3]));

    const snapshot = await adapter.getUpdates('doc-trim');
    expect(snapshot).toEqual([
      Uint8Array.from([2]),
      Uint8Array.from([3]),
    ]);
  });

  it('removes docs from storage', async () => {
    const adapter = createLocalStorageAdapter({ storage });
    await adapter.setSnapshot('doc-remove', Uint8Array.from([1]));
    await adapter.appendUpdate('doc-remove', Uint8Array.from([2]));

    await adapter.remove('doc-remove');

    const stored = await adapter.getUpdates('doc-remove');
    expect(stored).toBeNull();
  });

  it('uses namespace isolation', async () => {
    const docId = 'shared';
    const adapterA = createLocalStorageAdapter({
      storage,
      namespace: 'nsA',
    });
    const adapterB = createLocalStorageAdapter({
      storage,
      namespace: 'nsB',
    });

    await adapterA.appendUpdate(docId, Uint8Array.from([1]));
    await adapterB.appendUpdate(docId, Uint8Array.from([2]));
  });
});
