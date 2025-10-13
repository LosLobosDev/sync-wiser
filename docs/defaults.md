# Default Configuration

sync-wiser ships with conservative defaults so you can get a local prototype running with minimal setup. Override pieces as your needs evolve.

## Built-in defaults

- **`sync`**: `undefined` by default. Meaning: no remote pull/push; documents operate offline or rely on realtime alone. Add a `Sync` adapter when you have a server endpoint for reconciliation.
- **`realtime`**: `undefined`. No live broadcast out of the box. Useful for single-user testing or demos without WebSocket infrastructure.
- **`codec`**: No-op identity codec (`encode`/`decode` return the original `Uint8Array`). Keeps the pipeline simple until you need compression or encryption.
- **`policies.gc`**: `false`. Garbage collection is disabled initially to avoid surprising data loss during development. Enable it in production to reclaim detached items.
- **`policies.snapshotEvery`**: `undefined`. No automatic snapshot cadence. Pair with your storage strategy to control how clients capture local snapshots (updates are still streamed to the server on every mutation).
- **`policies.pullBeforePush`**: `true`. Ensures clients reconcile state vectors before pushing updates, matching Yjs’ recommended flow.
- **`policies.snapshotSync`**: `{ send: true, requestOnNewDocument: true }`. Clients upload a snapshot to sync when one hasn’t been sent yet and brand-new docs ask the server for a snapshot on first pull. Disable `send` to avoid resending after the first upload, or turn off `requestOnNewDocument` when your sync endpoint never wants snapshot payloads.
- **`cache.maxDocs`**: `20`. An in-memory LRU cache keeps the last N `Y.Doc` instances hydrated for faster access.
- **`logger`**: `console`. Logs go to the browser/dev console.
- **`onError`**: rethrows errors unless you supply a handler.

## When to override

- **Enable GC** when documents grow indefinitely and you’re comfortable pruning deleted content.
- **Set `snapshotEvery`** when client devices should periodically upload a fresh snapshot to accelerate cold starts. Snapshots complement, rather than replace, the continuous update stream. For example:

  ```ts
  policies: { snapshotEvery: { updates: 200 } }
  ```

- **Provide `sync`** if your users reconnect across devices or expect history downloads. Implementing even a simple REST adapter drastically improves cold-start performance.
- **Add `realtime`** when multiple collaborators edit simultaneously and need sub-second updates.
- **Swap in a `codec`** when bandwidth or data sensitivity demands compression/encryption.
- **Tweak `cache.maxDocs`** based on memory budgets or expected concurrency.
- **Replace `logger`/`onError`** to integrate with your observability stack (e.g. Sentry, Datadog).

## Example production-leaning config

```ts
import { PostgresStorage } from './adapters/postgres';
import { RestSync } from './adapters/rest';
import { WebSocketRealtime } from './adapters/websocket';
import { BrotliCodec } from './adapters/brotli';
import { logger } from './observability/logger';

export const config: Wiser.Config = {
  storage: new PostgresStorage(),
  sync: new RestSync(),
  realtime: new WebSocketRealtime(),
  codec: new BrotliCodec(),
  policies: {
    gc: true,
    snapshotEvery: { updates: 250, bytes: 256_000 },
    pullBeforePush: true,
    snapshotSync: {
      send: true,
      requestOnNewDocument: true,
    },
  },
  cache: { maxDocs: 100 },
  logger,
  onError: (error) => logger.error(error),
};
```

Adjust the thresholds and adapters to match your workload.
