# Adapters

sync-wiser relies on adapters to integrate with your infrastructure. Each adapter implements a small interface so you can plug in storage, sync, realtime transport, and codecs without touching core logic.

## Storage adapter (`Wiser.Storage`)

Responsible for persisting the latest snapshot **and** the append-only update log for each document. Minimum contract:

```ts
type Storage = {
  get(docId: string): Promise<{
    snapshot: Uint8Array | null;
    updates: Uint8Array[];
  } | null>;
  setSnapshot(docId: string, snapshot: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  remove(docId: string): Promise<void>;
};
```

### Usage guidance
- **Persistence strategy**: Map `docId` → { latest snapshot, ordered updates } into a durable store from day one—SQLite/Postgres, DynamoDB, or any KV/object storage that fits your stack. Reserve in-memory implementations strictly for unit tests.
- **Snapshots are hints**: Clients must upload every incremental update; snapshots simply let cold clients bootstrap faster. Treat snapshots as optional blobs you can hand out when a doc is requested with no local state.
- **Freshness metadata**: Track a lightweight version (e.g., monotonic counter or Yjs state vector hash) alongside snapshots so a stale snapshot upload never replaces a fresher one.
- **Concurrency**: If multiple workers handle the same doc, guard `setSnapshot`/`appendUpdate` with optimistic concurrency or transactional writes to preserve ordering.

### Built-in helpers
- `createInMemoryStorageAdapter()`: lightweight adapter for unit tests and playgrounds. Data resets when the process restarts.
- `createLocalStorageAdapter(options?)`: persists snapshots and update logs in `window.localStorage`. Accepts a `namespace`, custom `storage` implementation, and `maxUpdatesPerDoc` limit to trim history.

## Sync adapter (`Wiser.Sync`)

Handles pull/push reconciliation for clients that went offline. The server acts as a durable store—it does not need to run Yjs itself.

```ts
type Sync = {
  pull(docId: string, stateVector?: Uint8Array): Promise<Uint8Array | null>;
  push(docId: string, update: Uint8Array): Promise<void>;
};
```

### Usage guidance
- **Pull**: Clients include their Yjs state vector. The server simply returns the freshest snapshot or aggregated update it has stored—no CRDT merge logic required server-side because the client merges the response with its local doc.
- **Push**: Persist incoming updates as opaque `Uint8Array` blobs. Optionally fan them out via realtime transports, but avoid mutating their contents.
- **Transport**: REST endpoints, gRPC handlers, or message queues all work—the adapter only defines the signature.

## Realtime adapter (`Wiser.RealTime`)

Delivers live updates between connected clients.

```ts
type RealTime = {
  subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void;
  publish(docId: string, update: Uint8Array): Promise<void>;
};
```

### Usage guidance
- **Subscribe**: Register listeners on your transport (WebSocket, SignalR, Ably, WebRTC). Return an unsubscribe function to clean up.
- **Publish**: Broadcast the update to other subscribers. The format remains a raw Yjs update.
- **Fan-out**: Use presence or awareness alongside realtime to carry metadata like cursors.

## Codec adapter (`Wiser.Codec`)

Transforms serialized updates before hitting disk or the network.

```ts
type Codec = {
  encode(update: Uint8Array): Uint8Array;
  decode(update: Uint8Array): Uint8Array;
};
```

### Usage guidance
- **Encryption**: Encrypt at rest or over the wire without touching application code.
- **Versioning**: Migrate between schemas by rewriting updates in `encode`/`decode`.

## Putting it together

```ts
import { DrizzleAdapter } from '@sync-wiser/drizzle';
import { SignalRAdapter } from '@sync-wiser/signalr';
import { RESTAdapter } from '@sync-wiser/rest';
import { CompressionCodec } from '@sync-wiser/codecs';

const config: Wiser.Config = {
  storage: new DrizzleAdapter(),
  sync: new RESTAdapter(),
  realtime: new SignalRAdapter(),
  codec: new CompressionCodec(),
};
```

You can mix and match your own implementations—just adhere to the interfaces above.
