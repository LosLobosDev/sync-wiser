# Sync-Wiser Examples

This directory contains examples demonstrating how to use sync-wiser in different scenarios.

## Basic Example

The basic example (`basic.ts`) shows:
- Setting up a SyncEngine with memory storage
- Creating and modifying a Yjs document
- Persisting changes

To run:
```bash
npm install
npx ts-node examples/basic.ts
```

## Browser Example

The browser example (`browser.html`) demonstrates:
- Using IndexedDB for persistent storage
- Real-time collaboration between browser tabs
- Offline-first functionality

To run:
```bash
# Serve the HTML file with a simple HTTP server
npx http-server examples/
```

## Custom Adapters

The custom adapters example (`custom-adapters.ts`) shows:
- Implementing a custom storage adapter
- Implementing a custom transport adapter
- Integration patterns

## Testing Example

The testing example (`testing.ts`) demonstrates:
- Using MockTransportAdapter for testing
- Simulating network conditions
- Deterministic testing patterns
