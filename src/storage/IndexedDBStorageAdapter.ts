import { StorageAdapter } from '../core/types';

/**
 * IndexedDB storage adapter for browser-based persistence
 */
export class IndexedDBStorageAdapter implements StorageAdapter {
  private dbName: string;
  private db: IDBDatabase | null = null;

  constructor(dbName = 'sync-wiser-db') {
    this.dbName = dbName;
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains('updates')) {
          const updatesStore = db.createObjectStore('updates', { keyPath: 'id', autoIncrement: true });
          updatesStore.createIndex('docName', 'docName', { unique: false });
        }

        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'docName' });
        }
      };
    });
  }

  async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['updates'], 'readwrite');
      const store = transaction.objectStore('updates');
      const request = store.add({
        docName,
        update,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getUpdates(docName: string): Promise<Uint8Array[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['updates'], 'readonly');
      const store = transaction.objectStore('updates');
      const index = store.index('docName');
      const request = index.getAll(docName);

      request.onsuccess = () => {
        const updates = request.result.map((item: { update: Uint8Array }) => item.update);
        resolve(updates);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async storeSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    const db = await this.openDB();
    
    // Store snapshot
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['snapshots'], 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.put({
        docName,
        snapshot,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Clear updates for this document
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['updates'], 'readwrite');
      const store = transaction.objectStore('updates');
      const index = store.index('docName');
      const request = index.openCursor(docName);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getSnapshot(docName: string): Promise<Uint8Array | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['snapshots'], 'readonly');
      const store = transaction.objectStore('snapshots');
      const request = store.get(docName);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.snapshot : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearDocument(docName: string): Promise<void> {
    const db = await this.openDB();

    // Clear updates
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['updates'], 'readwrite');
      const store = transaction.objectStore('updates');
      const index = store.index('docName');
      const request = index.openCursor(docName);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });

    // Clear snapshot
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['snapshots'], 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.delete(docName);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
