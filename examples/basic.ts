/**
 * Basic example demonstrating sync-wiser usage
 */

import * as Y from 'yjs';
import { SyncEngine, MemoryStorageAdapter } from '../src';

async function main() {
  console.log('=== Sync-Wiser Basic Example ===\n');

  // Create a storage adapter
  const storage = new MemoryStorageAdapter();

  // Initialize the sync engine
  const engine = new SyncEngine({
    docName: 'example-doc',
    storage,
    autoSnapshot: false, // Manual snapshots for this example
  });

  await engine.initialize();
  console.log('✓ Engine initialized');

  // Get the Yjs document
  const doc = engine.getDoc();

  // Create a shared text field
  const text = doc.getText('content');
  
  // Make some changes
  text.insert(0, 'Hello, ');
  text.insert(7, 'World!');
  console.log('✓ Text updated:', text.toString());

  // Create a shared map
  const userMap = doc.getMap('users');
  userMap.set('alice', { name: 'Alice', role: 'admin' });
  userMap.set('bob', { name: 'Bob', role: 'user' });
  console.log('✓ User map created');

  // Wait for updates to be persisted
  await new Promise(resolve => setTimeout(resolve, 100));

  // Create a snapshot
  await engine.createSnapshot();
  console.log('✓ Snapshot created');

  // Verify data is persisted
  const updates = await storage.getUpdates('example-doc');
  const snapshot = await storage.getSnapshot('example-doc');
  console.log(`✓ Stored ${updates.length} updates and ${snapshot ? 1 : 0} snapshot`);

  // Simulate app restart - create new engine with same storage
  console.log('\n--- Simulating app restart ---\n');
  await engine.destroy();

  const engine2 = new SyncEngine({
    docName: 'example-doc',
    storage,
    autoSnapshot: false,
  });

  await engine2.initialize();
  console.log('✓ New engine initialized');

  // Verify data was restored
  const doc2 = engine2.getDoc();
  const text2 = doc2.getText('content');
  const userMap2 = doc2.getMap('users');

  console.log('✓ Text restored:', text2.toString());
  console.log('✓ Users restored:', {
    alice: userMap2.get('alice'),
    bob: userMap2.get('bob'),
  });

  // Cleanup
  await engine2.destroy();
  await storage.close();

  console.log('\n✓ Example completed successfully!');
}

main().catch(console.error);
