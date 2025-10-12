# sync-wiser

A lightweight, testable engine for local-first real-time collaboration built on Yjs. It handles syncing, persistence, and transport abstraction—letting your app focus on data, not networking.

## Features

⚡ **Offline-first sync** with replayable updates and snapshots  
🔄 **Transport-agnostic** (works with SignalR, WebSocket, etc.)  
💾 **Durable storage adapters** for SQLite, IndexedDB, or custom backends  
🔐 **Optional encryption/compression** layer  
🧪 **Built for deterministic testing** and reproducible merges  

## Installation

```bash
npm install sync-wiser yjs
```

## Quick Start

```typescript
import * as Y from 'yjs';
import { SyncEngine, MemoryStorageAdapter } from 'sync-wiser';

// Create a storage adapter
const storage = new MemoryStorageAdapter();

// Initialize the sync engine
const engine = new SyncEngine({
  docName: 'my-document',
  storage,
});

await engine.initialize();

// Get the Yjs document and start collaborating
const doc = engine.getDoc();
const text = doc.getText('content');
text.insert(0, 'Hello, collaborative world!');
```

## Core Concepts

### SyncEngine

The `SyncEngine` is the main orchestrator that manages:
- Local persistence via storage adapters
- Real-time sync via transport adapters (optional)
- Automatic snapshots and update management
- Optional encryption/compression

### Storage Adapters

Storage adapters handle persistent storage of document updates and snapshots:

#### MemoryStorageAdapter (for testing)
```typescript
import { MemoryStorageAdapter } from 'sync-wiser';

const storage = new MemoryStorageAdapter();
```

#### IndexedDBStorageAdapter (for browsers)
```typescript
import { IndexedDBStorageAdapter } from 'sync-wiser';

const storage = new IndexedDBStorageAdapter('my-db-name');
```

#### Custom Storage Adapter
```typescript
import { StorageAdapter } from 'sync-wiser';

class MyCustomStorage implements StorageAdapter {
  async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    // Store update to your backend
  }
  
  async getUpdates(docName: string): Promise<Uint8Array[]> {
    // Retrieve updates from your backend
  }
  
  async storeSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    // Store snapshot to your backend
  }
  
  async getSnapshot(docName: string): Promise<Uint8Array | null> {
    // Retrieve snapshot from your backend
  }
  
  async clearDocument(docName: string): Promise<void> {
    // Clear document data
  }
  
  async close(): Promise<void> {
    // Cleanup resources
  }
}
```

### Transport Adapters

Transport adapters enable real-time sync between peers:

#### WebSocketTransportAdapter
```typescript
import { WebSocketTransportAdapter } from 'sync-wiser';

const transport = new WebSocketTransportAdapter('ws://localhost:3000');

const engine = new SyncEngine({
  docName: 'my-document',
  storage,
  transport,
});
```

#### Custom Transport Adapter
```typescript
import { TransportAdapter } from 'sync-wiser';

class SignalRTransportAdapter implements TransportAdapter {
  async send(update: Uint8Array): Promise<void> {
    // Send update via SignalR
  }
  
  onReceive(callback: (update: Uint8Array) => void): void {
    // Register callback for incoming updates
  }
  
  onConnectionChange(callback: (connected: boolean) => void): void {
    // Register callback for connection status
  }
  
  async connect(): Promise<void> {
    // Connect to SignalR hub
  }
  
  async disconnect(): Promise<void> {
    // Disconnect from SignalR hub
  }
  
  isConnected(): boolean {
    // Return connection status
  }
}
```

### Crypto Adapters

Crypto adapters provide encryption and compression:

```typescript
import { CompressionCryptoAdapter } from 'sync-wiser';

const crypto = new CompressionCryptoAdapter();

const engine = new SyncEngine({
  docName: 'my-document',
  storage,
  crypto,
});
```

## Configuration Options

```typescript
interface SyncEngineConfig {
  // Name of the document to sync (required)
  docName: string;
  
  // Storage adapter for persistence (required)
  storage: StorageAdapter;
  
  // Optional transport for real-time sync
  transport?: TransportAdapter;
  
  // Optional crypto for encryption/compression
  crypto?: CryptoAdapter;
  
  // Auto-create snapshots (default: true)
  autoSnapshot?: boolean;
  
  // Snapshot interval in ms (default: 60000)
  snapshotInterval?: number;
  
  // Max updates before snapshot (default: 100)
  maxUpdatesBeforeSnapshot?: number;
}
```

## Advanced Usage

### Manual Snapshot Management

```typescript
const engine = new SyncEngine({
  docName: 'my-document',
  storage,
  autoSnapshot: false, // Disable automatic snapshots
});

await engine.initialize();

// Create snapshot manually when needed
await engine.createSnapshot();
```

### Offline-First with Sync

```typescript
import { SyncEngine, IndexedDBStorageAdapter, WebSocketTransportAdapter } from 'sync-wiser';

const storage = new IndexedDBStorageAdapter();
const transport = new WebSocketTransportAdapter('ws://localhost:3000');

const engine = new SyncEngine({
  docName: 'collaborative-doc',
  storage,
  transport,
});

await engine.initialize();

// Works offline - changes are stored locally
const doc = engine.getDoc();
const text = doc.getText('content');
text.insert(0, 'This works offline!');

// When connection is restored, changes sync automatically
// You can also manually trigger sync:
await engine.sync();
```

### Testing with Mock Transport

```typescript
import { MockTransportAdapter } from 'sync-wiser';

const transport = new MockTransportAdapter();

const engine = new SyncEngine({
  docName: 'test-doc',
  storage: new MemoryStorageAdapter(),
  transport,
});

await engine.initialize();

// Simulate receiving updates
const update = new Uint8Array([/* ... */]);
transport.simulateReceive(update);

// Check sent updates
const sentUpdates = transport.getSentUpdates();
```

### Cleanup

```typescript
// Clear all stored data for a document
await engine.clearStorage();

// Destroy engine and cleanup resources
await engine.destroy();

// Close storage adapter (if not shared)
await storage.close();
```

## Working with Yjs

Sync-wiser is built on [Yjs](https://yjs.dev/), a high-performance CRDT framework. Here are some common Yjs operations:

```typescript
const doc = engine.getDoc();

// Shared Text
const text = doc.getText('myText');
text.insert(0, 'Hello ');
text.insert(6, 'World');

// Shared Map
const map = doc.getMap('myMap');
map.set('key', 'value');

// Shared Array
const array = doc.getArray('myArray');
array.push(['item1', 'item2']);

// Observe changes
text.observe((event) => {
  console.log('Text changed:', event);
});
```

## Examples

See the `examples/` directory for complete examples:
- Basic usage
- Browser-based collaboration with IndexedDB
- Node.js server with WebSocket sync
- Custom adapters

## API Reference

### SyncEngine

#### Methods

- `initialize(): Promise<void>` - Initialize the engine and load stored data
- `getDoc(): Y.Doc` - Get the Yjs document
- `createSnapshot(): Promise<void>` - Create a snapshot manually
- `sync(): Promise<void>` - Manually sync with remote peers
- `clearStorage(): Promise<void>` - Clear all stored data
- `destroy(): Promise<void>` - Destroy engine and cleanup

### StorageAdapter Interface

- `storeUpdate(docName, update): Promise<void>`
- `getUpdates(docName): Promise<Uint8Array[]>`
- `storeSnapshot(docName, snapshot): Promise<void>`
- `getSnapshot(docName): Promise<Uint8Array | null>`
- `clearDocument(docName): Promise<void>`
- `close(): Promise<void>`

### TransportAdapter Interface

- `send(update): Promise<void>`
- `onReceive(callback): void`
- `onConnectionChange(callback): void`
- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `isConnected(): boolean`

### CryptoAdapter Interface

- `encrypt(data): Promise<Uint8Array>`
- `decrypt(data): Promise<Uint8Array>`

## License

Apache-2.0

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Acknowledgments

Built on top of the excellent [Yjs](https://yjs.dev/) CRDT framework.
