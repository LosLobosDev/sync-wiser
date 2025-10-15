# Adapters

sync-wiser relies on adapters to integrate with your infrastructure. Each adapter implements a small interface so you can plug in storage, sync, realtime transport, and codecs without touching core logic.

## Storage adapter (`Wiser.Storage`)

Responsible for persisting the latest snapshot **and** the append-only update log for each document.

```ts
type Storage = {
  getSnapshot?(docId: string): Promise<{
    snapshot: Uint8Array | null;
    snapshotGeneration?: number;
    syncedSnapshotGeneration?: number;
  } | null>;
  getUpdates(docId: string): Promise<Uint8Array[] | null>;
  getPendingSync?(docId: string): Promise<Uint8Array[] | null>;

  setSnapshot?(docId: string, snapshot: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  markPendingSync?(docId: string, updates: Uint8Array[]): Promise<void>;
  clearPendingSync?(docId: string): Promise<void>;
  markSnapshotSynced?(docId: string, generation: number): Promise<void>;
  remove(docId: string): Promise<void>;
};
```

> Use `assembleStoredDoc(adapter, docId)` from `src/storage/helpers` to materialize a combined `{ snapshot, updates, pendingSync }` structure in tooling or tests without reimplementing the glue logic.

### Usage guidance
- **Persistence strategy**: Map `docId` → { latest snapshot, ordered updates } into a durable store from day one—SQLite/Postgres, DynamoDB, or any KV/object storage that fits your stack. Reserve in-memory implementations strictly for unit tests.
- **Snapshots are hints**: Clients must upload every incremental update; snapshots simply let cold clients bootstrap faster. Cold-start pulls request a snapshot the first time unless you disable `policies.snapshotSync.requestOnNewDocument`.
- **Skip snapshots if you must**: When `setSnapshot` isn’t implemented, the runtime logs a warning and continues operating without on-disk snapshots.
- **Offline pending markers**: Implement `markPendingSync`/`clearPendingSync` so the runtime can persist the backlog of updates that still need to be pushed when connectivity returns. When these hooks are omitted, pending queues fall back to in-memory only.
- **Optional hooks warn once**: If you omit `markPendingSync`, `clearPendingSync`, or `markSnapshotSynced`, the runtime logs a warning the first time it needs them so you can decide whether to implement the persistence.
- **Snapshot sync metadata**: `snapshotGeneration`/`syncedSnapshotGeneration` let the runtime know whether the current snapshot has been uploaded to sync yet. We store and bump these automatically for you in the built-in adapters; replicate the logic in custom persistence layers so snapshot uploads stay idempotent.
- **Freshness metadata**: Track a lightweight version (e.g., monotonic counter or Yjs state vector hash) alongside snapshots so a stale snapshot upload never replaces a fresher one.
- **Concurrency**: If multiple workers handle the same doc, guard `setSnapshot` (when implemented)/`appendUpdate` with optimistic concurrency or transactional writes to preserve ordering.

### Built-in helpers
- `createInMemoryStorageAdapter()`: lightweight adapter for unit tests and playgrounds. Data resets when the process restarts.
- `createLocalStorageAdapter(options?)`: persists snapshots and update logs in `globalThis.localStorage`. Accepts a `namespace`, custom `storage` implementation, and `maxUpdatesPerDoc` limit to trim history. Provide a storage shim plus `globalThis.btoa/atob` (or enable `Buffer`) when running outside the browser, e.g., in React Native.

## Sync adapter (`Wiser.Sync`)

Handles pull/push reconciliation for clients that went offline. The server acts as a durable store—it does not need to run Yjs itself.

```ts
type Sync = {
  pull(
    docId: string,
    stateVector?: Uint8Array,
    options?: { requestSnapshot?: boolean }
  ): Promise<Uint8Array | null>;
  push(
    docId: string,
    update: Uint8Array,
    options?: { isSnapshot?: boolean }
  ): Promise<void>;
};
```

### Usage guidance
- **Pull**: Clients include their Yjs state vector. On brand-new docs the runtime omits the vector and sets `options.requestSnapshot = true` so servers can return a full snapshot cheaply.
- **Push**: Persist incoming updates as opaque `Uint8Array` blobs. When `options.isSnapshot` is `true`, treat the payload as a complete snapshot for storage instead of an incremental diff.
- **Transport**: REST endpoints, gRPC handlers, or message queues all work—the adapter only defines the signature.
- **Lifecycle**: As soon as a `sync` adapter is passed to `new WiserRuntime({ sync, storage, ... })`, the runtime issues the initial pull inside `getDocument(...)`, then automatically pushes on every mutation or pending-sync replay—no extra plumbing required.

### Built-in REST adapter

`createRestSyncAdapter(options)` wires the sync contract over REST, keeping the payload format flexible.

- **Server contract**: By default the adapter POSTs to `${baseUrl}/pull` and `${baseUrl}/push` with a bulk `documents` array (one entry per call). Responses must echo `dateLastSynced` so the client can checkpoint future pulls. Override `buildPullRequest`, `parsePullResponse`, `buildPushRequest`, or `parsePushResponse` when your API shape differs.
- **Snapshots vs updates**: On first sync (`lastSynced === null`) the adapter expects the server to return a snapshot. Subsequent pulls should omit snapshots and respond with updates issued since the supplied `dateLastSynced`.
- **Encoding**: Base64 is the default wire format. Provide `encodeUpdate`/`decodeUpdate` to swap in compressed binaries, hex strings, or anything else your backend prefers.
- **Checkpoint persistence**: Supply `getLastSynced`/`setLastSynced` to route timestamps into your own storage (KV, IndexedDB, AsyncStorage). When unspecified, the adapter keeps an in-memory map for the lifetime of the runtime.
- **Status UI**: Pair `createRestSyncAdapter` with `useSyncWiser()` to surface pull/push activity—and trigger manual reconciliations—directly from your React components.

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
import {
  createInMemoryStorageAdapter,
  createRestSyncAdapter,
  createSignalRRealtimeAdapter,
  WiserRuntime,
} from '@sync-wiser';

const config: Wiser.Config = {
  storage: createInMemoryStorageAdapter(),
  sync: createRestSyncAdapter({ baseUrl: 'https://api.example.com/sync' }),
  realtime: createSignalRRealtimeAdapter({ url: 'https://api.example.com/hub' }),
};
```

You can mix and match your own implementations—just adhere to the interfaces above.
