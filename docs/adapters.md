# Adapters

sync-wiser relies on adapters to integrate with your infrastructure. Each adapter implements a small interface so you can plug in storage, sync, realtime transport, and codecs without touching core logic.

## Storage adapter (`Wiser.Storage`)

Responsible for persisting document snapshots. Minimum contract:

```ts
type Storage = {
  get(docId: string): Promise<Uint8Array | null>;
  set(docId: string, snapshot: Uint8Array): Promise<void>;
  remove(docId: string): Promise<void>;
};
```

### Usage guidance
- **Persistence strategy**: Start with in-memory or file-based storage for prototypes. In production, map `docId` → `Uint8Array` into your SQL, KV, or object store.
- **Snapshots vs updates**: For large docs, store snapshots occasionally and incremental updates in between. Yjs encodes both via `Y.encodeStateAsUpdate`.
- **Concurrency**: If multiple workers handle the same doc, ensure `set` is idempotent or guarded by version checks.

## Sync adapter (`Wiser.Sync`)

Handles pull/push reconciliation for clients that need to catch up after being offline.

```ts
type Sync = {
  pull(docId: string, stateVector?: Uint8Array): Promise<Uint8Array | null>;
  push(docId: string, update: Uint8Array): Promise<void>;
};
```

### Usage guidance
- **Pull**: Use Yjs’ `Y.encodeStateVector` (client) and `Y.encodeStateAsUpdate` (server) to send only missing updates.
- **Push**: Persist the incoming update, then optionally broadcast through your realtime system.
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
- **Compression**: Apply gzip/brotli if bandwidth is a concern.
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
