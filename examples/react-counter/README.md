# sync-wiser React Counter Example

This example shows how to use `sync-wiser` on the client with the provided `WiserProvider`, `useWiserDoc` hook, and the in-memory storage adapter. It ships with a shared counter and todo list that stay in sync across browser tabs.

## Prerequisites

- Node.js 18+
- `pnpm`, `npm`, or `yarn`

## Getting started

```bash
cd examples/react-counter
npm install
npm run dev
```

Then open http://localhost:5173 in one or more browser tabs to try collaborative editing locally. The example aliases the workspace source (`../../src`) so changes to the library code reflect immediately in the demo.

## What to look at

- `src/models.ts`: defines Yjs-backed models with `Wiser.define`.
- `src/App.tsx`: wires `WiserProvider`, `createInMemoryStorageAdapter`, and the `useWiserDoc` hook to power UI interactions.
- `vite.config.ts`: aliases the root library so the demo uses the live source without publishing a package.
