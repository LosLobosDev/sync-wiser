import { describe, expect, it } from 'vitest';
import { Wiser } from '../src/wiser';
import { createInMemoryStorageAdapter } from '../src/storage/inMemoryStorageAdapter';
import { WiserRuntime } from '../src/runtime/runtime';

const Counter = Wiser.define('Counter', (y) => ({
  stats: y.map<number>(),
}));

describe('WiserRuntime', () => {
  it('mutates documents and persists updates', async () => {
    const storage = createInMemoryStorageAdapter();
    const runtime = new WiserRuntime({ storage });

    const handle = await runtime.getDocument('doc-1', Counter);

    await handle.mutate((draft) => {
      draft.stats.set('count', 1);
    });

    expect(handle.data.stats.get('count')).toBe(1);

    const stored = await storage.get('doc-1');
    expect(stored).not.toBeNull();
    expect(stored?.updates.length).toBeGreaterThanOrEqual(1);
  });

  it('captures snapshots when thresholds are reached without clearing updates', async () => {
    const storage = createInMemoryStorageAdapter();
    const runtime = new WiserRuntime({
      storage,
      policies: { snapshotEvery: { updates: 1 } },
    });

    const handle = await runtime.getDocument('doc-2', Counter);
    await handle.mutate((draft) => {
      draft.stats.set('count', 42);
    });

    const stored = await storage.get('doc-2');
    expect(stored).not.toBeNull();
    expect(stored?.snapshot).not.toBeNull();
    expect(stored?.updates.length).toBeGreaterThanOrEqual(1);
  });

  it('removes documents from storage', async () => {
    const storage = createInMemoryStorageAdapter();
    const runtime = new WiserRuntime({ storage });
    const handle = await runtime.getDocument('doc-3', Counter);

    await handle.mutate((draft) => {
      draft.stats.set('count', 7);
    });

    await handle.remove();

    const stored = await storage.get('doc-3');
    expect(stored).toBeNull();
  });
});
