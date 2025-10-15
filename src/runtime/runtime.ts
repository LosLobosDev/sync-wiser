import * as Y from 'yjs';
import type { StorageAdapter, WiserConfig, WiserModel } from '../types';
import { assembleStoredDoc } from '../storage/helpers';

const STORAGE_ORIGIN = Symbol('wiser/storage');
const SYNC_ORIGIN = Symbol('wiser/sync');
const REALTIME_ORIGIN = Symbol('wiser/realtime');

type ManagedDoc<TShape extends Record<string, unknown>> = {
  id: string;
  doc: Y.Doc;
  model: WiserModel<TShape>;
  data: TShape;
  updatesSinceSnapshot: number;
  bytesSinceSnapshot: number;
  snapshotGeneration: number;
  syncedSnapshotGeneration: number;
  isBrandNew: boolean;
  unsubscribe: () => void;
  realtimeUnsubscribe: (() => void) | null;
  syncQueue: Promise<void> | null;
  pendingSyncUpdates: Uint8Array[];
};

export type WiserDocumentHandle<TShape extends Record<string, unknown>> = {
  id: string;
  doc: Y.Doc;
  data: TShape;
  mutate(
    updater: (data: TShape) => void,
    options?: { origin?: unknown }
  ): Promise<void>;
  remove(): Promise<void>;
  sync(options?: WiserManualSyncOptions): Promise<void>;
};

export type WiserSyncEvent = {
  docId: string;
  direction: 'pull' | 'push';
  phase: 'start' | 'success' | 'error';
  isSnapshot?: boolean;
  requestSnapshot?: boolean;
  updatesApplied?: number;
  bytes?: number;
  error?: unknown;
  timestamp: number;
};

type SyncEventPayload = Omit<WiserSyncEvent, 'timestamp'>;

export type WiserManualSyncOptions = {
  pull?: boolean;
  push?: boolean;
  forceSnapshot?: boolean;
};

export class WiserRuntime {
  private readonly storage: StorageAdapter;
  private readonly config: WiserConfig;
  private readonly docs = new Map<string, ManagedDoc<any>>();
  private readonly missingStorageMethods = new Set<string>();
  private readonly syncListeners = new Set<(event: WiserSyncEvent) => void>();

  constructor(config: WiserConfig) {
    this.config = config;
    this.storage = config.storage;
  }

  async getDocument<TShape extends Record<string, unknown>>(
    id: string,
    model: WiserModel<TShape>
  ): Promise<WiserDocumentHandle<TShape>> {
    let entry = this.docs.get(id) as ManagedDoc<TShape> | undefined;

    if (!entry) {
      entry = await this.createManagedDoc(id, model);
      this.docs.set(id, entry);
    }

    return {
      id,
      doc: entry.doc,
      data: entry.data,
      mutate: (updater, options) =>
        this.mutate(entry!, updater, options?.origin),
      remove: () => this.remove(entry!),
      sync: (options) => this.syncDocument(entry!, options),
    };
  }

  private async createManagedDoc<TShape extends Record<string, unknown>>(
    id: string,
    model: WiserModel<TShape>
  ): Promise<ManagedDoc<TShape>> {
    const doc = new Y.Doc();
    const stored = await assembleStoredDoc(this.storage, id);
    if (stored) {
      if (stored.snapshot) {
        const snapshot = this.decode(stored.snapshot);
        Y.applyUpdate(doc, snapshot, STORAGE_ORIGIN);
      }
      for (const update of stored.updates) {
        const decoded = this.decode(update);
        Y.applyUpdate(doc, decoded, STORAGE_ORIGIN);
      }
    }
    const pendingSyncFromStorage = stored?.pendingSync ?? [];
    const snapshotGeneration =
      stored?.snapshotGeneration ?? (stored?.snapshot ? 1 : 0);
    const syncedSnapshotGeneration = stored?.syncedSnapshotGeneration ?? 0;
    const isBrandNew =
      !stored ||
      (!stored.snapshot &&
        stored.updates.length === 0 &&
        pendingSyncFromStorage.length === 0);
    const entry: ManagedDoc<TShape> = {
      id,
      doc,
      model,
      data: undefined as unknown as TShape,
      updatesSinceSnapshot: 0,
      bytesSinceSnapshot: 0,
      snapshotGeneration,
      syncedSnapshotGeneration,
      isBrandNew,
      unsubscribe: () => {
        /* replaced after handler registration */
      },
      realtimeUnsubscribe: null,
      syncQueue: null,
      pendingSyncUpdates: pendingSyncFromStorage.map((update) => update.slice()),
    };

    await this.fetchAndApplyFromSync(entry);

    const { data } = model.instantiate(doc);
    entry.data = data;
    this.refreshModelData(entry);

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === STORAGE_ORIGIN) {
        return;
      }

      this.refreshModelData(entry);

      const encoded = this.encode(update);
      if (origin === SYNC_ORIGIN) {
        this.persistUpdate(id, encoded, entry, { markPending: false }).catch(
          (error) => this.reportError(error)
        );
        return;
      }
      if (origin === REALTIME_ORIGIN) {
        this.persistUpdate(id, encoded, entry, { markPending: false }).catch(
          (error) => this.reportError(error)
        );
        return;
      }

      const persistPromise = this.persistUpdate(id, encoded, entry, {
        markPending: true,
      });

      persistPromise.catch((error) => this.reportError(error));

      if (!this.config.sync) {
        if (this.config.realtime) {
          this.enqueueSync(entry, async () => {
            await persistPromise;
            await this.publishRealtime(entry, encoded);
          });
        }
        return;
      }

      this.enqueueSync(entry, async () => {
        await persistPromise;
        await this.syncOutgoingUpdate(entry, encoded);
        await this.publishRealtime(entry, encoded);
      });
    };

    doc.on('update', updateHandler);
    entry.unsubscribe = () => {
      doc.off('update', updateHandler);
    };

    entry.realtimeUnsubscribe = this.subscribeRealtime(entry);

    if (entry.pendingSyncUpdates.length > 0 && this.config.sync) {
      const pendingQueue = entry.pendingSyncUpdates.slice();
      for (const pendingUpdate of pendingQueue) {
        this.enqueueSync(entry, () =>
          this.syncOutgoingUpdate(entry, pendingUpdate)
        );
      }
    }

    return entry;
  }

  private async mutate<TShape extends Record<string, unknown>>(
    entry: ManagedDoc<TShape>,
    updater: (shape: TShape) => void,
    origin?: unknown
  ) {
    entry.doc.transact(() => updater(entry.data), origin);
  }

  private async remove(entry: ManagedDoc<any>) {
    entry.unsubscribe();
    if (entry.realtimeUnsubscribe) {
      entry.realtimeUnsubscribe();
      entry.realtimeUnsubscribe = null;
    }
    this.docs.delete(entry.id);
    await this.storage.remove(entry.id);
  }

  private async persistUpdate(
    id: string,
    update: Uint8Array,
    entry: ManagedDoc<any>,
    options: { markPending: boolean }
  ) {
    await this.storage.appendUpdate(id, update);
    if (options.markPending) {
      const pending = [...entry.pendingSyncUpdates, update.slice()];
      await this.setPendingSyncState(entry, pending);
    }
    entry.updatesSinceSnapshot += 1;
    entry.bytesSinceSnapshot += update.byteLength;

    await this.maybeSnapshot(entry);
  }

  private async fetchAndApplyFromSync(entry: ManagedDoc<any>) {
    const { sync } = this.config;
    if (!sync) return;

    const shouldRequestSnapshot =
      entry.isBrandNew &&
      (this.config.policies?.snapshotSync?.requestOnNewDocument ?? true);
    const stateVector = shouldRequestSnapshot
      ? undefined
      : Y.encodeStateVector(entry.doc);
    const pullOptions = shouldRequestSnapshot
      ? { requestSnapshot: true }
      : undefined;
    this.emitSyncEvent({
      docId: entry.id,
      direction: 'pull',
      phase: 'start',
      requestSnapshot: shouldRequestSnapshot,
    });
    let result: Uint8Array | null = null;
    try {
      result = await sync.pull(entry.id, stateVector, pullOptions);
    } catch (error) {
      this.emitSyncEvent({
        docId: entry.id,
        direction: 'pull',
        phase: 'error',
        requestSnapshot: shouldRequestSnapshot,
        error,
      });
      throw error;
    }
    entry.isBrandNew = false;
    if (!result || result.length === 0) {
      this.emitSyncEvent({
        docId: entry.id,
        direction: 'pull',
        phase: 'success',
        requestSnapshot: shouldRequestSnapshot,
        updatesApplied: 0,
        bytes: 0,
      });
      return;
    }

    const decoded = this.decode(result);
    Y.applyUpdate(entry.doc, decoded, SYNC_ORIGIN);
    if (entry.data) {
      this.refreshModelData(entry);
    }
    const snapshot = this.encode(Y.encodeStateAsUpdate(entry.doc));
    await this.storeSnapshot(entry, snapshot, {
      markSynced: true,
      resetCounters: true,
    });
    this.emitSyncEvent({
      docId: entry.id,
      direction: 'pull',
      phase: 'success',
      requestSnapshot: shouldRequestSnapshot,
      updatesApplied: 1,
      bytes: result.byteLength,
    });
  }

  private async syncOutgoingUpdate(
    entry: ManagedDoc<any>,
    update: Uint8Array
  ): Promise<void> {
    const { sync } = this.config;
    if (!sync) return;

    const shouldPullFirst = this.config.policies?.pullBeforePush !== false;

    if (shouldPullFirst) {
      await this.fetchAndApplyFromSync(entry);
    }

    await this.syncSnapshotIfNeeded(entry);

    await this.pushWithEvents(entry, update, { isSnapshot: false });
    if (entry.pendingSyncUpdates.length > 0) {
      const [, ...remaining] = entry.pendingSyncUpdates;
      await this.setPendingSyncState(entry, remaining);
    }
  }

  private enqueueSync(
    entry: ManagedDoc<any>,
    task: () => Promise<void>
  ): Promise<void> {
    const chain = entry.syncQueue ?? Promise.resolve();
    const next = chain.then(task);
    entry.syncQueue = next.catch((error) => {
      this.reportError(error);
    });
    return next;
  }

  private refreshModelData(entry: ManagedDoc<any>) {
    const latest = entry.model.ensureStructure(entry.doc);
    if (!entry.data) {
      entry.data = latest;
      return;
    }
    for (const key of Object.keys(latest)) {
      (entry.data as Record<string, unknown>)[key] = (latest as Record<
        string,
        unknown
      >)[key];
    }
  }

  private async setPendingSyncState(
    entry: ManagedDoc<any>,
    updates: Uint8Array[]
  ): Promise<void> {
    entry.pendingSyncUpdates = updates.map((update) => update.slice());

    if (updates.length === 0) {
      if (this.storage.clearPendingSync) {
        await this.storage.clearPendingSync(entry.id);
      } else if (this.storage.markPendingSync) {
        await this.storage.markPendingSync(entry.id, []);
      } else {
        this.warnMissingStorageMethod('clearPendingSync');
      }
      return;
    }

    if (this.storage.markPendingSync) {
      await this.storage.markPendingSync(entry.id, entry.pendingSyncUpdates);
    } else {
      this.warnMissingStorageMethod('markPendingSync');
    }
  }

  private async syncSnapshotIfNeeded(entry: ManagedDoc<any>): Promise<void> {
    const { sync } = this.config;
    if (!sync) return;

    let snapshotPayload: Uint8Array | null = null;

    if (entry.snapshotGeneration === 0) {
      snapshotPayload = this.encode(Y.encodeStateAsUpdate(entry.doc));
      await this.storeSnapshot(entry, snapshotPayload, {
        markSynced: false,
        resetCounters: true,
      });
    }

    const hasUnsyncedSnapshot =
      entry.snapshotGeneration > entry.syncedSnapshotGeneration;

    if (!hasUnsyncedSnapshot) {
      return;
    }

    const sendPolicy = this.config.policies?.snapshotSync?.send;
    if (sendPolicy === false && entry.syncedSnapshotGeneration > 0) {
      return;
    }

    if (!snapshotPayload) {
      snapshotPayload = this.encode(Y.encodeStateAsUpdate(entry.doc));
    }

    await this.pushWithEvents(entry, snapshotPayload, { isSnapshot: true });
    entry.syncedSnapshotGeneration = entry.snapshotGeneration;
    if (this.storage.markSnapshotSynced) {
      await this.storage.markSnapshotSynced(
        entry.id,
        entry.syncedSnapshotGeneration
      );
    } else {
      this.warnMissingStorageMethod('markSnapshotSynced');
    }
  }

  private async maybeSnapshot(entry: ManagedDoc<any>): Promise<void> {
    const { snapshotEvery } = this.config.policies ?? {};
    if (!snapshotEvery) return;

    const { updates: updateThreshold, bytes } = snapshotEvery;
    const shouldSnapshot =
      (typeof updateThreshold === 'number' &&
        entry.updatesSinceSnapshot >= updateThreshold) ||
      (typeof bytes === 'number' && entry.bytesSinceSnapshot >= bytes);

    if (!shouldSnapshot) return;

    const encoded = this.encode(Y.encodeStateAsUpdate(entry.doc));
    await this.storeSnapshot(entry, encoded, {
      markSynced: false,
      resetCounters: true,
    });
  }

  private async storeSnapshot(
    entry: ManagedDoc<any>,
    snapshot: Uint8Array,
    options: { markSynced: boolean; resetCounters?: boolean }
  ): Promise<void> {
    if (this.storage.setSnapshot) {
      await this.storage.setSnapshot(entry.id, snapshot);
    } else {
      this.warnMissingStorageMethod('setSnapshot');
    }

    entry.snapshotGeneration += 1;
    if (options.resetCounters) {
      entry.updatesSinceSnapshot = 0;
      entry.bytesSinceSnapshot = 0;
    }
    if (options.markSynced) {
      entry.syncedSnapshotGeneration = entry.snapshotGeneration;
      if (this.storage.markSnapshotSynced) {
        await this.storage.markSnapshotSynced(
          entry.id,
          entry.syncedSnapshotGeneration
        );
      } else {
        this.warnMissingStorageMethod('markSnapshotSynced');
      }
    } else if (entry.syncedSnapshotGeneration > entry.snapshotGeneration) {
      entry.syncedSnapshotGeneration = entry.snapshotGeneration;
    }
  }

  private encode(update: Uint8Array): Uint8Array {
    return this.config.codec ? this.config.codec.encode(update) : update;
  }

  private decode(update: Uint8Array): Uint8Array {
    return this.config.codec ? this.config.codec.decode(update) : update;
  }

  private subscribeRealtime(entry: ManagedDoc<any>): (() => void) | null {
    const adapter = this.config.realtime;
    if (!adapter) return null;

    try {
      const unsubscribe = adapter.subscribe(entry.id, (incoming) => {
        try {
          const decoded = this.decode(incoming);
          Y.applyUpdate(entry.doc, decoded, REALTIME_ORIGIN);
          this.refreshModelData(entry);
        } catch (error) {
          this.reportError(error);
        }
      });
      return unsubscribe;
    } catch (error) {
      this.reportError(error);
      return null;
    }
  }

  private async publishRealtime(
    entry: ManagedDoc<any>,
    update: Uint8Array
  ): Promise<void> {
    const adapter = this.config.realtime;
    if (!adapter) return;

    await adapter.publish(entry.id, update);
  }

  private reportError(error: unknown) {
    if (this.config.onError) {
      this.config.onError(error);
      return;
    }
    this.config.logger?.error?.('[sync-wiser]', error);
  }

  private warnMissingStorageMethod(method: string) {
    if (this.missingStorageMethods.has(method)) {
      return;
    }
    this.missingStorageMethods.add(method);
    const message = `[sync-wiser] StorageAdapter does not implement ${method}(); functionality may be limited.`;
    if (this.config.logger?.warn) {
      this.config.logger.warn(message);
    } else {
      console.warn(message);
    }
  }

  private async pushWithEvents(
    entry: ManagedDoc<any>,
    update: Uint8Array,
    options: { isSnapshot: boolean }
  ): Promise<void> {
    const { sync } = this.config;
    if (!sync) return;

    this.emitSyncEvent({
      docId: entry.id,
      direction: 'push',
      phase: 'start',
      isSnapshot: options.isSnapshot,
      bytes: update.byteLength,
    });
    try {
      await sync.push(entry.id, update, { isSnapshot: options.isSnapshot });
      this.emitSyncEvent({
        docId: entry.id,
        direction: 'push',
        phase: 'success',
        isSnapshot: options.isSnapshot,
        bytes: update.byteLength,
      });
    } catch (error) {
      this.emitSyncEvent({
        docId: entry.id,
        direction: 'push',
        phase: 'error',
        isSnapshot: options.isSnapshot,
        bytes: update.byteLength,
        error,
      });
      throw error;
    }
  }

  private async syncDocument(
    entry: ManagedDoc<any>,
    options?: WiserManualSyncOptions
  ): Promise<void> {
    const { pull = true, push = true, forceSnapshot = false } = options ?? {};

    if (!this.config.sync) {
      return;
    }

    await this.enqueueSync(entry, async () => {
      if (pull) {
        await this.fetchAndApplyFromSync(entry);
      }

      if (push) {
        if (forceSnapshot) {
          const encoded = this.encode(Y.encodeStateAsUpdate(entry.doc));
          await this.storeSnapshot(entry, encoded, {
            markSynced: false,
          });
        }

        await this.syncSnapshotIfNeeded(entry);

        const pendingQueue = entry.pendingSyncUpdates.slice();
        for (const pending of pendingQueue) {
          await this.syncOutgoingUpdate(entry, pending);
        }
      }
    });
  }

  onSyncEvent(listener: (event: WiserSyncEvent) => void): () => void {
    this.syncListeners.add(listener);
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  private emitSyncEvent(event: SyncEventPayload) {
    if (this.syncListeners.size === 0) {
      return;
    }
    const enriched: WiserSyncEvent = {
      ...event,
      timestamp: Date.now(),
    };
    for (const listener of this.syncListeners) {
      try {
        listener(enriched);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  async syncNow(
    id: string,
    options?: WiserManualSyncOptions
  ): Promise<void> {
    const entry = this.docs.get(id);
    if (!entry) {
      throw new Error(
        `[sync-wiser] Document "${id}" is not loaded; call getDocument() before syncing manually.`
      );
    }
    await this.syncDocument(entry, options);
  }
}
