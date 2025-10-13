# sync-wiser
A lightweight engine for local-first, real-time collaboration built on Yjs. sync-wiser wraps syncing, persistence, and transport abstractions so your app can stay focused on product logic instead of networking.

## Why sync-wiser
- Built on Yjs primitives (`Y.Doc`, `Y.Text`, etc.), inheriting conflict-free merges, offline support, and granular updates. See https://docs.yjs.dev for the underlying CRDT model.
- One config object wires storage, sync, realtime, codecs, and policies—swap infrastructure without rewriting domain logic.
- Model tokens carry TypeScript types end-to-end, letting hooks infer shapes without generics or manual casting.
- React hooks and the headless runtime ship together, keeping bundle size small and tree-shakeable.

## Install

```bash
# npm
npm install @sync-wiser

# or pnpm
pnpm add @sync-wiser

# or yarn
yarn add @sync-wiser
```

> The same package exposes the `@sync-wiser/react` entrypoint, so one install covers both runtime and hooks. Add any adapters (Drizzle, REST, SignalR, etc.) that match your stack.

## Quickstart

### 1. Define a collaborative model

```ts
import { Wiser } from '@sync-wiser';

// Types flow from the token returned by define()
export const ShoppingList = Wiser.define('ShoppingList', (y) => ({
  name: y.text(),
  items: y.array<{
    id: string;
    name: string;
    checked: boolean;
    notes: string;
  }>(),
  preferences: y.map<{ color: string; icon: string }>(),
}));
```

### 2. Mount the provider with a minimal config

```tsx
import { WiserProvider } from '@sync-wiser/react';
import { createLocalStorageAdapter } from '@sync-wiser';

const wiserConfig: Wiser.Config = {
  storage: createLocalStorageAdapter(), // required – persists snapshots plus the update log
  // Optional (sync, realtime, codec, policies, cache, logger, onError)
  // start with safe defaults. Override pieces as your deployment matures.
};

export function AppRoot() {
  return (
    <WiserProvider config={wiserConfig}>
      <App />
    </WiserProvider>
  );
}
```

### 3. Use shared state in React

```tsx
import * as React from 'react';
import { useWiserDoc } from '@sync-wiser/react';
import { ShoppingList } from './models';

export function List({ id }: { id: string }) {
  const [text, setText] = React.useState('');
  const { data, mutate, remove } = useWiserDoc(id, ShoppingList);

  const addItem = async () => {
    const name = text.trim();
    if (!name) return;
    await mutate((draft) => {
      draft.items.push([
        { id: crypto.randomUUID(), name, checked: false, notes: '' },
      ]);
    });
    setText('');
  };

  const toggle = async (itemId: string) => {
    await mutate((draft) => {
      const i = draft.items.toArray().findIndex((x) => x.id === itemId);
      if (i >= 0) {
        const item = draft.items.get(i)!;
        draft.items.delete(i, 1);
        draft.items.insert(i, [{ ...item, checked: !item.checked }]);
      }
    });
  };

  const removeItem = async (itemId: string) => {
    await mutate((draft) => {
      const i = draft.items.toArray().findIndex((x) => x.id === itemId);
      if (i >= 0) draft.items.delete(i, 1);
    });
  };

  const deleteList = () => remove();

  if (!data) return <div>Loading…</div>;

  return (
    <div>
      <h1>{data.name.toString()}</h1>

      {data.items.toArray().map((item) => (
        <div key={item.id}>
          <input
            type="checkbox"
            checked={item.checked}
            onChange={() => toggle(item.id)}
          />
          <label>{item.name}</label>
          <button onClick={() => removeItem(item.id)}>delete</button>
        </div>
      ))}

      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add item…" />
      <button onClick={addItem}>Add</button>

      <hr />
      <button onClick={deleteList}>Delete list</button>
    </div>
  );
}
```

---

## How sync-wiser layers on Yjs
- Each model wraps a `Y.Doc`. Mutations run inside Yjs transactions; when they close, sync-wiser generates updates that merge conflict-free across peers.
- The `storage` adapter persists snapshots alongside the append-only update log. Snapshots are optional accelerators for cold starts; clients must still stream every update to the server. See https://docs.yjs.dev/api/document-updates for encoding details.
- The `sync` adapter handles pull/push reconciliation so reconnecting devices can catch up even without realtime transport.
- The `realtime` adapter fans out updates in real time (WebSocket, SignalR, WebRTC, etc.).
- Codecs let you transform `Uint8Array` payloads (compression/encryption) before persistence or transport.
- Policies expose Yjs best practices such as garbage collection and snapshot cadence to keep doc size under control.

## Configuration cheatsheet
- **`storage`** *(required)*: implements `{ get, setSnapshot, appendUpdate, remove }` and can optionally provide `markPendingSync/clearPendingSync` so offline work survives restarts. `get` returns the latest snapshot, queued updates, and any pending sync backlog.
- **`sync`**: batch reconciliation path for clients that reconnect or request history.
- **`realtime`**: live pub/sub channel for hot updates.
- **`codec`**: transform updates (compression, encryption, schema migration).
- **`policies`**: tune GC, snapshot intervals (`updates`/`bytes` thresholds), and `pullBeforePush`.
- **`cache`**, **`logger`**, **`onError`**: operational controls for memory, observability, and resilience.

> Need exact type signatures? Inspect the generated `.d.ts` files in `node_modules/@sync-wiser` or use your editor’s “Go to Definition”.

## Next steps
1. Prototype with an in-memory `storage` adapter, then plug in your persistence (SQL/KV/Object storage).
2. Layer in a `sync` route that mirrors Yjs’ update encoding so cold clients can catch up fast.
3. Add presence by pairing sync-wiser with Yjs Awareness if you need cursors, selections, or typing indicators.

## Examples
- `examples/react-counter`: React + Vite demo showing `WiserProvider`, `useWiserDoc`, and the storage adapters powering a shared counter and todo list.
