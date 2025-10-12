/**
 * Storage adapter interface for persisting Yjs documents
 */
export interface StorageAdapter {
  /**
   * Store a document update
   */
  storeUpdate(docName: string, update: Uint8Array): Promise<void>;

  /**
   * Retrieve all updates for a document
   */
  getUpdates(docName: string): Promise<Uint8Array[]>;

  /**
   * Store a document snapshot
   */
  storeSnapshot(docName: string, snapshot: Uint8Array): Promise<void>;

  /**
   * Retrieve the latest snapshot for a document
   */
  getSnapshot(docName: string): Promise<Uint8Array | null>;

  /**
   * Clear all data for a document
   */
  clearDocument(docName: string): Promise<void>;

  /**
   * Close the storage adapter and cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Transport adapter interface for sending/receiving updates
 */
export interface TransportAdapter {
  /**
   * Send an update to connected peers
   */
  send(update: Uint8Array): Promise<void>;

  /**
   * Register a callback for receiving updates
   */
  onReceive(callback: (update: Uint8Array) => void): void;

  /**
   * Register a callback for connection status changes
   */
  onConnectionChange(callback: (connected: boolean) => void): void;

  /**
   * Connect to the transport
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the transport
   */
  disconnect(): Promise<void>;

  /**
   * Check if currently connected
   */
  isConnected(): boolean;
}

/**
 * Crypto adapter interface for encryption/compression
 */
export interface CryptoAdapter {
  /**
   * Encrypt and/or compress data
   */
  encrypt(data: Uint8Array): Promise<Uint8Array>;

  /**
   * Decrypt and/or decompress data
   */
  decrypt(data: Uint8Array): Promise<Uint8Array>;
}

/**
 * Configuration for the sync engine
 */
export interface SyncEngineConfig {
  /**
   * Name of the document to sync
   */
  docName: string;

  /**
   * Storage adapter for persistence
   */
  storage: StorageAdapter;

  /**
   * Optional transport adapter for real-time sync
   */
  transport?: TransportAdapter;

  /**
   * Optional crypto adapter for encryption/compression
   */
  crypto?: CryptoAdapter;

  /**
   * Whether to automatically save snapshots periodically (default: true)
   */
  autoSnapshot?: boolean;

  /**
   * Interval in milliseconds between automatic snapshots (default: 60000)
   */
  snapshotInterval?: number;

  /**
   * Maximum number of updates to keep before creating a snapshot (default: 100)
   */
  maxUpdatesBeforeSnapshot?: number;
}

/**
 * Snapshot metadata
 */
export interface Snapshot {
  docName: string;
  timestamp: number;
  data: Uint8Array;
}

/**
 * Update metadata
 */
export interface Update {
  docName: string;
  timestamp: number;
  data: Uint8Array;
}
