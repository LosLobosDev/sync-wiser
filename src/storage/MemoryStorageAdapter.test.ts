import { MemoryStorageAdapter } from '../storage/MemoryStorageAdapter';

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  test('should store and retrieve updates', async () => {
    const docName = 'test-doc';
    const update1 = new Uint8Array([1, 2, 3]);
    const update2 = new Uint8Array([4, 5, 6]);

    await adapter.storeUpdate(docName, update1);
    await adapter.storeUpdate(docName, update2);

    const updates = await adapter.getUpdates(docName);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual(update1);
    expect(updates[1]).toEqual(update2);
  });

  test('should store and retrieve snapshots', async () => {
    const docName = 'test-doc';
    const snapshot = new Uint8Array([10, 20, 30]);

    await adapter.storeSnapshot(docName, snapshot);

    const retrieved = await adapter.getSnapshot(docName);
    expect(retrieved).toEqual(snapshot);
  });

  test('should clear updates when storing snapshot', async () => {
    const docName = 'test-doc';
    const update = new Uint8Array([1, 2, 3]);
    const snapshot = new Uint8Array([10, 20, 30]);

    await adapter.storeUpdate(docName, update);
    await adapter.storeSnapshot(docName, snapshot);

    const updates = await adapter.getUpdates(docName);
    expect(updates).toHaveLength(0);
  });

  test('should clear document data', async () => {
    const docName = 'test-doc';
    const update = new Uint8Array([1, 2, 3]);
    const snapshot = new Uint8Array([10, 20, 30]);

    await adapter.storeUpdate(docName, update);
    await adapter.storeSnapshot(docName, snapshot);
    await adapter.clearDocument(docName);

    const updates = await adapter.getUpdates(docName);
    const retrievedSnapshot = await adapter.getSnapshot(docName);

    expect(updates).toHaveLength(0);
    expect(retrievedSnapshot).toBeNull();
  });

  test('should return null for non-existent snapshot', async () => {
    const snapshot = await adapter.getSnapshot('non-existent');
    expect(snapshot).toBeNull();
  });

  test('should return empty array for non-existent updates', async () => {
    const updates = await adapter.getUpdates('non-existent');
    expect(updates).toHaveLength(0);
  });

  test('should handle multiple documents', async () => {
    const update1 = new Uint8Array([1]);
    const update2 = new Uint8Array([2]);

    await adapter.storeUpdate('doc1', update1);
    await adapter.storeUpdate('doc2', update2);

    const updates1 = await adapter.getUpdates('doc1');
    const updates2 = await adapter.getUpdates('doc2');

    expect(updates1).toHaveLength(1);
    expect(updates2).toHaveLength(1);
    expect(updates1[0]).toEqual(update1);
    expect(updates2[0]).toEqual(update2);
  });
});
