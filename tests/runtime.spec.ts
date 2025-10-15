import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Wiser } from '../src/wiser';
import { createInMemoryStorageAdapter } from '../src/storage/inMemoryStorageAdapter';
import { WiserRuntime } from '../src/runtime/runtime';
import type { WiserSyncEvent } from '../src/runtime/runtime';
import type {
  RealtimeAdapter,
  StorageAdapter,
  SyncAdapter,
  SyncPullOptions,
  SyncPushOptions,
} from '../src/types';

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

    const stored = await storage.getSnapshot!('doc-1');
    expect(stored).not.toBeNull();
    expect((await storage.getUpdates!('doc-1'))?.length).toBeGreaterThanOrEqual(1);
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
    const storedSnapshot = await storage.getSnapshot!('doc-2');
    expect(storedSnapshot).not.toBeNull();
    expect(storedSnapshot?.snapshot).not.toBeNull();
    expect((await storage.getUpdates!('doc-2'))?.length).toBeGreaterThanOrEqual(1);
  });

  it('removes documents from storage', async () => {
    const storage = createInMemoryStorageAdapter();
    const runtime = new WiserRuntime({ storage });
    const handle = await runtime.getDocument('doc-3', Counter);

    await handle.mutate((draft) => {
      draft.stats.set('count', 7);
    });

    await handle.remove();

    const stored = await storage.getUpdates('doc-3');
    expect(stored).toBeNull();
  });

  it('pulls remote updates from the sync adapter on initialization', async () => {
    const storage = createInMemoryStorageAdapter();
    const remoteDoc = new Y.Doc();
    const { data: remoteData } = Counter.instantiate(remoteDoc);
    remoteData.stats.set('count', 5);
    const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);

    const syncCalls: Array<{
      stateVector: Uint8Array | undefined;
      options: SyncPullOptions | undefined;
    }> = [];
    const pullMock = vi.fn(
      async (
        _docId: string,
        stateVector?: Uint8Array,
        options?: SyncPullOptions
      ) => {
        syncCalls.push({ stateVector, options });
        return remoteUpdate;
      }
    );
    const pushMock = vi.fn(
      async (
        _docId: string,
        _update: Uint8Array,
        _options?: SyncPushOptions
      ) => {
        /* noop */
      }
    );
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

    const stored = await storage.getSnapshot!('doc-sync');
    expect(stored).not.toBeNull();
    expect(stored).not.toBeNull();
    expect(pullMock).toHaveBeenCalledTimes(1);
    expect(syncCalls[0]?.stateVector).toBeUndefined();
    expect(syncCalls[0]?.options?.requestSnapshot).toBe(true);
  });

  it('pushes local updates through the sync adapter with pullBeforePush enabled', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullCalls: Array<{
      stateVector: Uint8Array | undefined;
      options: SyncPullOptions | undefined;
    }> = [];
    const pullMock = vi.fn(
      async (
        _docId: string,
        stateVector?: Uint8Array,
        options?: SyncPullOptions
      ) => {
        pullCalls.push({ stateVector, options });
        return null;
      }
    );
    const pushMock = vi.fn(
      async (
        _docId: string,
        _update: Uint8Array,
        options?: SyncPushOptions
      ) => {
        return;
      }
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
    expect(pullCalls[0]?.stateVector).toBeUndefined();
    expect(pullCalls[0]?.options?.requestSnapshot).toBe(true);
    expect(pullCalls[1]?.stateVector).toBeInstanceOf(Uint8Array);
    expect(pullCalls[1]?.options).toBeUndefined();
    expect(pushMock).toHaveBeenCalledTimes(2);
    const firstPush = pushMock.mock.calls[0];
    expect(firstPush?.[2]?.isSnapshot).toBe(true);
    const [, pushPayload] = pushMock.mock.calls[1];
    expect(pushPayload).toBeInstanceOf(Uint8Array);
  });

  it('skips pull before push when the policy is disabled', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullMock = vi.fn(
      async (
        _docId: string,
        _stateVector?: Uint8Array,
        _options?: SyncPullOptions
      ) => null
    );
    const pushMock = vi.fn(
      async (
        _docId: string,
        _update: Uint8Array,
        _options?: SyncPushOptions
      ) => {
        return;
      }
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
    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(pushMock.mock.calls[0]?.[2]?.isSnapshot).toBe(true);
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

    const pendingSync = await storage.getPendingSync!('doc-offline');
    expect(pendingSync ?? []).toHaveLength(1);

    const pullMock = vi.fn(
      async (
        _docId: string,
        _stateVector?: Uint8Array,
        _options?: SyncPullOptions
      ) => null
    );
    const pushMock = vi.fn(
      async (
        _docId: string,
        _update: Uint8Array,
        _options?: SyncPushOptions
      ) => undefined
    );

    const onlineRuntime = new WiserRuntime({
      storage,
      sync: { pull: pullMock, push: pushMock },
    });

    await onlineRuntime.getDocument('doc-offline', Counter);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(pushMock.mock.calls[0]?.[2]?.isSnapshot).toBe(true);
    const pendingSync2 = await storage.getPendingSync!('doc-offline');
    expect(pendingSync2 ?? []).toHaveLength(0);
  });

  it('sends at most one snapshot when snapshot sync send is disabled', async () => {
    const storage = createInMemoryStorageAdapter();
    const pushCalls: Array<SyncPushOptions | undefined> = [];
    const pullMock = vi.fn(
      async (
        _docId: string,
        _stateVector?: Uint8Array,
        _options?: SyncPullOptions
      ) => null
    );
    const pushMock = vi.fn(
      async (
        _docId: string,
        _update: Uint8Array,
        options?: SyncPushOptions
      ) => {
        pushCalls.push(options);
      }
    );

    const runtime = new WiserRuntime({
      storage,
      sync: { pull: pullMock, push: pushMock },
      policies: {
        snapshotEvery: { updates: 1 },
        snapshotSync: { send: false },
      },
    });

    const handle = await runtime.getDocument('doc-sync-limited', Counter);

    await handle.mutate((draft) => {
      draft.stats.set('count', 1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await handle.mutate((draft) => {
      draft.stats.set('count', 2);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pushMock).toHaveBeenCalledTimes(3);
    expect(pushCalls[0]?.isSnapshot).toBe(true);
    expect(pushCalls[1]?.isSnapshot).toBe(false);
    expect(pushCalls[2]?.isSnapshot).toBe(false);
  });

  it('requests incremental sync when snapshot requests are disabled for new docs', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullCalls: Array<{
      stateVector: Uint8Array | undefined;
      options: SyncPullOptions | undefined;
    }> = [];
    const pullMock = vi.fn(
      async (
        _docId: string,
        stateVector?: Uint8Array,
        options?: SyncPullOptions
      ) => {
        pullCalls.push({ stateVector, options });
        return null;
      }
    );
    const pushMock = vi.fn(
      async (
        _docId: string,
        _update: Uint8Array,
        _options?: SyncPushOptions
      ) => undefined
    );

    const runtime = new WiserRuntime({
      storage,
      sync: { pull: pullMock, push: pushMock },
      policies: { snapshotSync: { requestOnNewDocument: false } },
    });

    await runtime.getDocument('doc-sync-policy-request', Counter);

    expect(pullCalls).toHaveLength(1);
    expect(pullCalls[0]?.stateVector).toBeInstanceOf(Uint8Array);
    expect(pullCalls[0]?.options?.requestSnapshot).toBeUndefined();
  });

  it('hydrates using granular storage getters without invoking get', async () => {
    const seededDoc = new Y.Doc();
    const { data: seededData } = Counter.instantiate(seededDoc);
    seededData.stats.set('count', 11);
    const seededSnapshot = Y.encodeStateAsUpdate(seededDoc);

    const calls = {
      getSnapshot: 0,
      getUpdates: 0,
      getPendingSync: 0,
      appendUpdate: 0,
    };

    const updatesPushed: Uint8Array[] = [];

    const storage: StorageAdapter = {
      async getSnapshot() {
        calls.getSnapshot += 1;
        return {
          snapshot: seededSnapshot,
          snapshotGeneration: 1,
          syncedSnapshotGeneration: 0,
        };
      },
      async getUpdates() {
        calls.getUpdates += 1;
        return [];
      },
      async getPendingSync() {
        calls.getPendingSync += 1;
        return [];
      },
      async appendUpdate(_docId, update) {
        calls.appendUpdate += 1;
        updatesPushed.push(update);
      },
      async markPendingSync() {
        /* noop */
      },
      async clearPendingSync() {
        /* noop */
      },
      async remove() {
        /* noop */
      },
    };

    const runtime = new WiserRuntime({ storage });
    const handle = await runtime.getDocument('doc-granular', Counter);

    expect(handle.data.stats.get('count')).toBe(11);
    expect(calls.getSnapshot).toBe(1);
    expect(calls.getUpdates).toBe(1);
    expect(calls.getPendingSync).toBe(1);

    await handle.mutate((draft) => {
      draft.stats.set('count', 12);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.appendUpdate).toBe(1);
    expect(updatesPushed[0]).toBeInstanceOf(Uint8Array);
  });

  it('applies realtime updates and persists without marking them pending', async () => {
    const storage = createInMemoryStorageAdapter();
    let realtimeCallback: ((update: Uint8Array) => void) | null = null;
    const unsubscribe = vi.fn();
    const publishMock = vi.fn(async () => {
      /* noop */
    });
    const realtime: RealtimeAdapter = {
      subscribe: vi.fn((_docId: string, onUpdate: (update: Uint8Array) => void) => {
        realtimeCallback = onUpdate;
        return unsubscribe;
      }),
      publish: publishMock,
    };

    const runtime = new WiserRuntime({ storage, realtime });
    const handle = await runtime.getDocument('doc-realtime-inbound', Counter);

    expect(realtime.subscribe).toHaveBeenCalledTimes(1);
    expect(realtimeCallback).not.toBeNull();

    const remoteDoc = new Y.Doc();
    const { data: remoteData } = Counter.instantiate(remoteDoc);
    remoteData.stats.set('count', 9);
    const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);

    realtimeCallback!(remoteUpdate);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handle.data.stats.get('count')).toBe(9);
    const pendingSync = await storage.getPendingSync!('doc-realtime-inbound');
    expect(pendingSync ?? []).toHaveLength(0);
    const storedUpdates = await storage.getUpdates('doc-realtime-inbound');
    expect(storedUpdates ?? []).not.toHaveLength(0);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('publishes local updates over realtime transport', async () => {
    const storage = createInMemoryStorageAdapter();
    const unsubscribe = vi.fn();
    const publishMock = vi.fn(async () => {
      /* noop */
    });
    const realtime: RealtimeAdapter = {
      subscribe: vi.fn((_docId: string) => unsubscribe),
      publish: publishMock,
    };

    const runtime = new WiserRuntime({ storage, realtime });
    const handle = await runtime.getDocument('doc-realtime-outbound', Counter);

    await handle.mutate((draft) => {
      draft.stats.set('count', 4);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publishMock).toHaveBeenCalledTimes(1);
    const [, payload] = publishMock.mock.calls[0]!;
    expect(payload).toBeInstanceOf(Uint8Array);
    await handle.mutate((draft) => {
      draft.stats.set('count', 5);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publishMock).toHaveBeenCalledTimes(2);
  });

  it('cleans up realtime subscriptions when removing a document', async () => {
    const storage = createInMemoryStorageAdapter();
    const unsubscribe = vi.fn();
    const realtime: RealtimeAdapter = {
      subscribe: vi.fn((_docId: string) => unsubscribe),
      publish: vi.fn(async () => {
        /* noop */
      }),
    };

    const runtime = new WiserRuntime({ storage, realtime });
    const handle = await runtime.getDocument('doc-realtime-remove', Counter);

    await handle.remove();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('emits sync events for pull and push operations', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullMock = vi.fn(async () => null);
    const pushMock = vi.fn(async () => undefined);
    const sync: SyncAdapter = {
      pull: pullMock,
      push: pushMock,
    };
    const runtime = new WiserRuntime({ storage, sync });
    const events: WiserSyncEvent[] = [];
    runtime.onSyncEvent((event) => {
      events.push(event);
    });

    const handle = await runtime.getDocument('doc-sync-events', Counter);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pullMock).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (event) =>
          event.direction === 'pull' && event.phase === 'start' && event.requestSnapshot === true
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.direction === 'pull' && event.phase === 'success' && event.requestSnapshot === true
      )
    ).toBe(true);

    const initialEventCount = events.length;

    await handle.mutate((draft) => {
      draft.stats.set('count', 1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pushMock).toHaveBeenCalled();
    const newEvents = events.slice(initialEventCount);
    expect(
      newEvents.some(
        (event) => event.direction === 'push' && event.phase === 'start'
      )
    ).toBe(true);
    expect(
      newEvents.some(
        (event) => event.direction === 'push' && event.phase === 'success'
      )
    ).toBe(true);
    expect(
      newEvents.some(
        (event) => event.direction === 'push' && event.isSnapshot === true
      )
    ).toBe(true);
  });

  it('supports manual syncNow calls with configurable options', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullMock = vi.fn(async () => null);
    const pushMock = vi.fn(async () => undefined);
    const runtime = new WiserRuntime({ storage, sync: { pull: pullMock, push: pushMock } });

    await runtime.getDocument('doc-manual-sync', Counter);

    const initialPulls = pullMock.mock.calls.length;
    await runtime.syncNow('doc-manual-sync', { pull: true, push: false });
    expect(pullMock.mock.calls.length).toBe(initialPulls + 1);

    const initialPushes = pushMock.mock.calls.length;
    await runtime.syncNow('doc-manual-sync', {
      pull: false,
      push: true,
      forceSnapshot: true,
    });
    expect(pushMock.mock.calls.length).toBeGreaterThan(initialPushes);
  });
});
