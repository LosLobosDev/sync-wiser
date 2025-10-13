import * as Y from 'yjs';
import type {
  StorageAdapter,
  WiserConfig,
  WiserModel,
} from '../types';

const STORAGE_ORIGIN = Symbol('wiser/storage');
const SYNC_ORIGIN = Symbol('wiser/sync');

type ManagedDoc<TShape extends Record<string, unknown>> = {
  id: string;
  doc: Y.Doc;
  model: WiserModel<TShape>;
  data: TShape;
  updatesSinceSnapshot: number;
  bytesSinceSnapshot: number;
  unsubscribe: () => void;
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
};

export class WiserRuntime {
  private readonly storage: StorageAdapter;
  private readonly config: WiserConfig;
  private readonly docs = new Map<string, ManagedDoc<any>>();

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
    };
  }

  private async createManagedDoc<TShape extends Record<string, unknown>>(
    id: string,
    model: WiserModel<TShape>
  ): Promise<ManagedDoc<TShape>> {
    const doc = new Y.Doc();
    const stored = await this.storage.get(id);
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
    const { data } = model.instantiate(doc);

    let entry!: ManagedDoc<TShape>;
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

      const persistPromise = this.persistUpdate(id, encoded, entry, {
        markPending: true,
      });

      persistPromise.catch((error) => this.reportError(error));

      if (!this.config.sync) {
        return;
      }

      this.enqueueSync(entry, async () => {
        await persistPromise;
        await this.syncOutgoingUpdate(entry, encoded);
      });
    };

    doc.on('update', updateHandler);
    entry = {
      id,
      doc,
      model,
      data,
      updatesSinceSnapshot: 0,
      bytesSinceSnapshot: 0,
      unsubscribe: () => {
        doc.off('update', updateHandler);
      },
      syncQueue: null,
      pendingSyncUpdates:
        stored?.pendingSync?.map((update) => update.slice()) ?? [],
    };

    await this.fetchAndApplyFromSync(entry);

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

    await this.maybeSnapshot(id, entry);
  }

  private async fetchAndApplyFromSync(entry: ManagedDoc<any>) {
    const { sync } = this.config;
    if (!sync) return;

    const stateVector = Y.encodeStateVector(entry.doc);
    const result = await sync.pull(entry.id, stateVector);
    if (!result || result.length === 0) {
      return;
    }

    const decoded = this.decode(result);
    Y.applyUpdate(entry.doc, decoded, SYNC_ORIGIN);
    this.refreshModelData(entry);
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

    await sync.push(entry.id, update);
    if (entry.pendingSyncUpdates.length > 0) {
      const [, ...remaining] = entry.pendingSyncUpdates.slice();
      await this.setPendingSyncState(entry, remaining);
    }
  }

  private enqueueSync(
    entry: ManagedDoc<any>,
    task: () => Promise<void>
  ): void {
    const chain = entry.syncQueue ?? Promise.resolve();
    const next = chain.then(task);
    entry.syncQueue = next.catch((error) => {
      this.reportError(error);
    });
  }

  private refreshModelData(entry: ManagedDoc<any>) {
    const latest = entry.model.ensureStructure(entry.doc);
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
      }
      return;
    }

    if (this.storage.markPendingSync) {
      await this.storage.markPendingSync(entry.id, entry.pendingSyncUpdates);
    }
  }

  private async maybeSnapshot(
    id: string,
    entry: ManagedDoc<any>
  ): Promise<void> {
    const { snapshotEvery } = this.config.policies ?? {};
    if (!snapshotEvery) return;

    const { updates: updateThreshold, bytes } = snapshotEvery;
    const shouldSnapshot =
      (typeof updateThreshold === 'number' &&
        entry.updatesSinceSnapshot >= updateThreshold) ||
      (typeof bytes === 'number' && entry.bytesSinceSnapshot >= bytes);

    if (!shouldSnapshot) return;

    const snapshot = Y.encodeStateAsUpdate(entry.doc);
    const encoded = this.encode(snapshot);

    await this.storage.setSnapshot(id, encoded);
    entry.updatesSinceSnapshot = 0;
    entry.bytesSinceSnapshot = 0;
  }

  private encode(update: Uint8Array): Uint8Array {
    return this.config.codec ? this.config.codec.encode(update) : update;
  }

  private decode(update: Uint8Array): Uint8Array {
    return this.config.codec ? this.config.codec.decode(update) : update;
  }

  private reportError(error: unknown) {
    if (this.config.onError) {
      this.config.onError(error);
      return;
    }
    this.config.logger?.error?.('[sync-wiser]', error);
  }
}
