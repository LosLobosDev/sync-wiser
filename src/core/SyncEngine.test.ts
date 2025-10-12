import * as Y from 'yjs';
import { SyncEngine } from '../core/SyncEngine';
import { MemoryStorageAdapter } from '../storage/MemoryStorageAdapter';
import { MockTransportAdapter } from '../transports/MockTransportAdapter';

describe('SyncEngine', () => {
  let storage: MemoryStorageAdapter;
  let transport: MockTransportAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    transport = new MockTransportAdapter();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('initialization', () => {
    test('should initialize without transport', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        autoSnapshot: false,
      });

      await engine.initialize();
      const doc = engine.getDoc();
      expect(doc).toBeInstanceOf(Y.Doc);

      await engine.destroy();
    });

    test('should initialize with transport', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        transport,
        autoSnapshot: false,
      });

      await engine.initialize();
      expect(transport.isConnected()).toBe(true);

      await engine.destroy();
    });

    test('should not reinitialize if already initialized', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        autoSnapshot: false,
      });

      await engine.initialize();
      await engine.initialize(); // Should not throw

      await engine.destroy();
    });
  });

  describe('local updates', () => {
    test('should persist local updates', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        autoSnapshot: false,
      });

      await engine.initialize();
      const doc = engine.getDoc();
      const text = doc.getText('test');

      text.insert(0, 'Hello');
      
      // Wait a bit for the update to be processed
      await new Promise(resolve => setTimeout(resolve, 10));

      const updates = await storage.getUpdates('test-doc');
      expect(updates.length).toBeGreaterThan(0);

      await engine.destroy();
    });

    test('should restore state from storage', async () => {
      const sharedStorage = new MemoryStorageAdapter();
      
      // First engine writes data
      const engine1 = new SyncEngine({
        docName: 'test-doc',
        storage: sharedStorage,
        autoSnapshot: false,
      });

      await engine1.initialize();
      const doc1 = engine1.getDoc();
      const text1 = doc1.getText('test');
      text1.insert(0, 'Hello World');

      await new Promise(resolve => setTimeout(resolve, 100));
      await engine1.destroy();

      // Second engine reads data
      const engine2 = new SyncEngine({
        docName: 'test-doc',
        storage: sharedStorage,
        autoSnapshot: false,
      });

      await engine2.initialize();
      const doc2 = engine2.getDoc();
      const text2 = doc2.getText('test');
      
      expect(text2.toString()).toBe('Hello World');

      await engine2.destroy();
      await sharedStorage.close();
    });
  });

  describe('snapshots', () => {
    test('should create manual snapshot', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        autoSnapshot: false,
      });

      await engine.initialize();
      const doc = engine.getDoc();
      const text = doc.getText('test');
      text.insert(0, 'Snapshot test');

      await engine.createSnapshot();

      const snapshot = await storage.getSnapshot('test-doc');
      expect(snapshot).not.toBeNull();

      await engine.destroy();
    });

    test('should create snapshot after max updates', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        maxUpdatesBeforeSnapshot: 3,
        autoSnapshot: false,
      });

      await engine.initialize();
      const doc = engine.getDoc();
      const text = doc.getText('test');

      // Create multiple updates
      text.insert(0, 'A');
      await new Promise(resolve => setTimeout(resolve, 10));
      text.insert(1, 'B');
      await new Promise(resolve => setTimeout(resolve, 10));
      text.insert(2, 'C');
      await new Promise(resolve => setTimeout(resolve, 10));

      const snapshot = await storage.getSnapshot('test-doc');
      expect(snapshot).not.toBeNull();

      await engine.destroy();
    });
  });

  describe('transport sync', () => {
    test('should send updates via transport', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        transport,
        autoSnapshot: false,
      });

      await engine.initialize();
      const doc = engine.getDoc();
      const text = doc.getText('test');

      transport.clearSentUpdates();
      text.insert(0, 'Transport test');

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentUpdates = transport.getSentUpdates();
      expect(sentUpdates.length).toBeGreaterThan(0);

      await engine.destroy();
    });

    test('should receive and apply remote updates', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        transport,
        autoSnapshot: false,
      });

      await engine.initialize();
      const doc = engine.getDoc();

      // Create a remote update
      const remoteDoc = new Y.Doc();
      const remoteText = remoteDoc.getText('test');
      remoteText.insert(0, 'Remote update');
      const update = Y.encodeStateAsUpdate(remoteDoc);

      // Simulate receiving the update
      transport.simulateReceive(update);

      await new Promise(resolve => setTimeout(resolve, 10));

      const text = doc.getText('test');
      expect(text.toString()).toBe('Remote update');

      await engine.destroy();
    });
  });

  describe('cleanup', () => {
    test('should clear storage', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        autoSnapshot: false,
      });

      await engine.initialize();
      const doc = engine.getDoc();
      const text = doc.getText('test');
      text.insert(0, 'Clear me');

      await new Promise(resolve => setTimeout(resolve, 10));
      await engine.clearStorage();

      const updates = await storage.getUpdates('test-doc');
      expect(updates.length).toBe(0);

      await engine.destroy();
    });

    test('should cleanup resources on destroy', async () => {
      const engine = new SyncEngine({
        docName: 'test-doc',
        storage,
        transport,
        autoSnapshot: false,
      });

      await engine.initialize();
      await engine.destroy();

      expect(transport.isConnected()).toBe(false);
    });
  });
});
