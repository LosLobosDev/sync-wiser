import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Wiser } from '../src/wiser';
import { createInMemoryStorageAdapter } from '../src/storage/inMemoryStorageAdapter';
import { WiserRuntime } from '../src/runtime/runtime';
import type { SyncAdapter } from '../src/types';

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

    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('pulls remote updates from the sync adapter on initialization', async () => {
    const storage = createInMemoryStorageAdapter();
    const remoteDoc = new Y.Doc();
    const { data: remoteData } = Counter.instantiate(remoteDoc);
    remoteData.stats.set('count', 5);
    const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);

    const syncCalls: Array<{ stateVector: Uint8Array }> = [];
    const pullMock = vi.fn<
      [string, Uint8Array | undefined],
      Promise<Uint8Array | null>
    >(async (_docId, stateVector) => {
      if (stateVector) {
        syncCalls.push({ stateVector });
      }
      return remoteUpdate;
    });
    const pushMock = vi.fn<[string, Uint8Array], Promise<void>>(async () => {
      /* noop */
    });
    const sync: SyncAdapter = {
      pull: pullMock,
      push: pushMock,
    };

    const runtime = new WiserRuntime({ storage, sync });
    const handle = await runtime.getDocument('doc-sync', Counter);

    for (let i = 0; i < 5 && handle.data.stats.get('count') === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const docJSON = handle.doc.toJSON();
    expect(docJSON).toEqual({ __wiser_root__: { stats: { count: 5 } } });

    const stored = await storage.get('doc-sync');
    expect(stored).not.toBeNull();
    expect(stored?.snapshot).not.toBeNull();
    expect(pullMock).toHaveBeenCalledTimes(1);
    expect(syncCalls[0]?.stateVector).toBeInstanceOf(Uint8Array);
  });

  it('pushes local updates through the sync adapter with pullBeforePush enabled', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullMock = vi.fn<
      [string, Uint8Array | undefined],
      Promise<Uint8Array | null>
    >().mockResolvedValue(null);
    const pushMock = vi.fn<[string, Uint8Array], Promise<void>>().mockResolvedValue(
      undefined
    );
    const sync: SyncAdapter = {
      pull: pullMock,
      push: pushMock,
    };

    const runtime = new WiserRuntime({ storage, sync });
    const handle = await runtime.getDocument('doc-sync-push', Counter);

    await handle.mutate((draft) => {
      draft.stats.set('count', 10);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pullMock).toHaveBeenCalledTimes(2); // initial + pullBeforePush
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [, pushPayload] = pushMock.mock.calls[0];
    expect(pushPayload).toBeInstanceOf(Uint8Array);
  });

  it('skips pull before push when the policy is disabled', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullMock = vi.fn<
      [string, Uint8Array | undefined],
      Promise<Uint8Array | null>
    >().mockResolvedValue(null);
    const pushMock = vi.fn<[string, Uint8Array], Promise<void>>().mockResolvedValue(
      undefined
    );
    const sync: SyncAdapter = {
      pull: pullMock,
      push: pushMock,
    };

    const runtime = new WiserRuntime({
      storage,
      sync,
      policies: { pullBeforePush: false },
    });

    const handle = await runtime.getDocument('doc-sync-policy', Counter);

    await handle.mutate((draft) => {
      draft.stats.set('count', 2);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pullMock).toHaveBeenCalledTimes(1); // only initial pull
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('flushes pending updates saved offline once sync becomes available', async () => {
    const storage = createInMemoryStorageAdapter();
    const offlineRuntime = new WiserRuntime({ storage });
    const offlineHandle = await offlineRuntime.getDocument(
      'doc-offline',
      Counter
    );

    await offlineHandle.mutate((draft) => {
      draft.stats.set('count', 3);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const storedBefore = await storage.get('doc-offline');
    expect(storedBefore?.pendingSync ?? []).toHaveLength(1);

    const pullMock = vi
      .fn<[string, Uint8Array | undefined], Promise<Uint8Array | null>>()
      .mockResolvedValue(null);
    const pushMock = vi.fn<[string, Uint8Array], Promise<void>>().mockResolvedValue(
      undefined
    );

    const onlineRuntime = new WiserRuntime({
      storage,
      sync: { pull: pullMock, push: pushMock },
    });

    await onlineRuntime.getDocument('doc-offline', Counter);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pushMock).toHaveBeenCalledTimes(1);
    const storedAfter = await storage.get('doc-offline');
    expect(storedAfter?.pendingSync ?? []).toHaveLength(0);
  });
});
