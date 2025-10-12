import * as Y from 'yjs';
import { SyncEngineConfig, StorageAdapter, TransportAdapter, CryptoAdapter } from './types';

/**
 * SyncEngine: Core engine for local-first real-time collaboration
 * 
 * Handles syncing, persistence, and transport abstraction for Yjs documents.
 * Supports offline-first operation with replayable updates and snapshots.
 */
export class SyncEngine {
  private doc: Y.Doc;
  private config: SyncEngineConfig & {
    autoSnapshot: boolean;
    snapshotInterval: number;
    maxUpdatesBeforeSnapshot: number;
  };
  private storage: StorageAdapter;
  private transport?: TransportAdapter;
  private crypto?: CryptoAdapter;
  private snapshotTimer?: NodeJS.Timeout;
  private updateCount = 0;
  private isInitialized = false;
  private isSyncing = false;

  constructor(config: SyncEngineConfig) {
    this.doc = new Y.Doc();
    this.storage = config.storage;
    this.transport = config.transport;
    this.crypto = config.crypto;

    this.config = {
      ...config,
      autoSnapshot: config.autoSnapshot ?? true,
      snapshotInterval: config.snapshotInterval ?? 60000,
      maxUpdatesBeforeSnapshot: config.maxUpdatesBeforeSnapshot ?? 100,
    };
  }

  /**
   * Initialize the sync engine
   * Loads stored data and sets up synchronization
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Load snapshot and updates from storage
    await this.loadFromStorage();

    // Set up document update handler
    this.doc.on('update', this.handleUpdate.bind(this));

    // Set up transport if provided
    if (this.transport) {
      await this.setupTransport();
    }

    // Set up automatic snapshots
    if (this.config.autoSnapshot) {
      this.startSnapshotTimer();
    }

    this.isInitialized = true;
  }

  /**
   * Get the Yjs document
   */
  getDoc(): Y.Doc {
    return this.doc;
  }

  /**
   * Load document state from storage
   */
  private async loadFromStorage(): Promise<void> {
    try {
      // Try to load snapshot first
      const snapshot = await this.storage.getSnapshot(this.config.docName);
      if (snapshot) {
        const data = this.crypto ? await this.crypto.decrypt(snapshot) : snapshot;
        Y.applyUpdate(this.doc, data, this);
      }

      // Apply stored updates
      const updates = await this.storage.getUpdates(this.config.docName);
      for (const update of updates) {
        const data = this.crypto ? await this.crypto.decrypt(update) : update;
        Y.applyUpdate(this.doc, data, this);
      }
    } catch (error) {
      console.error('Error loading from storage:', error);
      throw error;
    }
  }

  /**
   * Handle document updates
   */
  private async handleUpdate(update: Uint8Array, origin: unknown): Promise<void> {
    // Don't process updates from sync operations to avoid loops
    if (origin === this) {
      return;
    }

    try {
      // Store the update
      const data = this.crypto ? await this.crypto.encrypt(update) : update;
      await this.storage.storeUpdate(this.config.docName, data);
      this.updateCount++;

      // Send to transport if connected
      if (this.transport && this.transport.isConnected() && !this.isSyncing) {
        await this.transport.send(update);
      }

      // Create snapshot if threshold reached
      if (this.updateCount >= this.config.maxUpdatesBeforeSnapshot) {
        await this.createSnapshot();
      }
    } catch (error) {
      console.error('Error handling update:', error);
    }
  }

  /**
   * Set up transport for real-time sync
   */
  private async setupTransport(): Promise<void> {
    if (!this.transport) {
      return;
    }

    // Handle incoming updates
    this.transport.onReceive(async (update: Uint8Array) => {
      try {
        this.isSyncing = true;
        Y.applyUpdate(this.doc, update, this);
        
        // Store received updates
        const data = this.crypto ? await this.crypto.encrypt(update) : update;
        await this.storage.storeUpdate(this.config.docName, data);
      } catch (error) {
        console.error('Error applying remote update:', error);
      } finally {
        this.isSyncing = false;
      }
    });

    // Handle connection changes
    this.transport.onConnectionChange(async (connected: boolean) => {
      if (connected) {
        // Send current state when reconnecting
        const state = Y.encodeStateAsUpdate(this.doc);
        await this.transport!.send(state);
      }
    });

    // Connect
    await this.transport.connect();
  }

  /**
   * Create a snapshot of the current document state
   */
  async createSnapshot(): Promise<void> {
    try {
      const snapshot = Y.encodeStateAsUpdate(this.doc);
      const data = this.crypto ? await this.crypto.encrypt(snapshot) : snapshot;
      
      await this.storage.storeSnapshot(this.config.docName, data);
      
      // Reset update counter
      this.updateCount = 0;
    } catch (error) {
      console.error('Error creating snapshot:', error);
      throw error;
    }
  }

  /**
   * Start automatic snapshot timer
   */
  private startSnapshotTimer(): void {
    this.snapshotTimer = setInterval(
      () => this.createSnapshot(),
      this.config.snapshotInterval
    );
  }

  /**
   * Stop automatic snapshot timer
   */
  private stopSnapshotTimer(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  /**
   * Manually sync with remote peers
   */
  async sync(): Promise<void> {
    if (!this.transport || !this.transport.isConnected()) {
      throw new Error('Transport not connected');
    }

    const state = Y.encodeStateAsUpdate(this.doc);
    await this.transport.send(state);
  }

  /**
   * Clear all stored data for this document
   */
  async clearStorage(): Promise<void> {
    await this.storage.clearDocument(this.config.docName);
    this.updateCount = 0;
  }

  /**
   * Destroy the sync engine and cleanup resources
   * Note: Does not close storage adapter as it may be shared
   */
  async destroy(): Promise<void> {
    this.stopSnapshotTimer();

    if (this.transport) {
      await this.transport.disconnect();
    }

    this.doc.destroy();
    this.isInitialized = false;
  }
}
