import * as Y from 'yjs';
import type {
  StorageAdapter,
  WiserConfig,
  WiserModel,
} from '../types';

const STORAGE_ORIGIN = Symbol('wiser/storage');

type ManagedDoc<TShape extends Record<string, unknown>> = {
  id: string;
  doc: Y.Doc;
  model: WiserModel<TShape>;
  data: TShape;
  updatesSinceSnapshot: number;
  bytesSinceSnapshot: number;
  unsubscribe: () => void;
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
    await this.hydrateFromStorage(id, doc);
    const { data } = model.instantiate(doc);

    let entry!: ManagedDoc<TShape>;
    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === STORAGE_ORIGIN) {
        return;
      }

      const encoded = this.encode(update);

      this.persistUpdate(id, encoded, entry).catch((error) =>
        this.reportError(error)
      );
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
    };

    return entry;
  }

  private async hydrateFromStorage(id: string, doc: Y.Doc) {
    const stored = await this.storage.get(id);
    if (!stored) return;

    if (stored.snapshot) {
      const snapshot = this.decode(stored.snapshot);
      Y.applyUpdate(doc, snapshot, STORAGE_ORIGIN);
    }

    for (const update of stored.updates) {
      const decoded = this.decode(update);
      Y.applyUpdate(doc, decoded, STORAGE_ORIGIN);
    }
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
    entry: ManagedDoc<any>
  ) {
    await this.storage.appendUpdate(id, update);
    entry.updatesSinceSnapshot += 1;
    entry.bytesSinceSnapshot += update.byteLength;

    await this.maybeSnapshot(id, entry);
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
