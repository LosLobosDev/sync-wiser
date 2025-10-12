import { StorageAdapter } from '../core/types';

/**
 * In-memory storage adapter for testing and temporary storage
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private updates: Map<string, Uint8Array[]> = new Map();
  private snapshots: Map<string, Uint8Array> = new Map();

  async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    if (!this.updates.has(docName)) {
      this.updates.set(docName, []);
    }
    this.updates.get(docName)!.push(update);
  }

  async getUpdates(docName: string): Promise<Uint8Array[]> {
    return this.updates.get(docName) || [];
  }

  async storeSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    this.snapshots.set(docName, snapshot);
    // Clear updates when snapshot is created
    this.updates.set(docName, []);
  }

  async getSnapshot(docName: string): Promise<Uint8Array | null> {
    return this.snapshots.get(docName) || null;
  }

  async clearDocument(docName: string): Promise<void> {
    this.updates.delete(docName);
    this.snapshots.delete(docName);
  }

  async close(): Promise<void> {
    // Don't clear data on close - data should persist
    // Only clear if explicitly requested via clearDocument
  }
}
