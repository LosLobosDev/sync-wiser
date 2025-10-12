import { TransportAdapter } from '../core/types';

/**
 * Mock transport adapter for testing
 */
export class MockTransportAdapter implements TransportAdapter {
  private connected = false;
  private receiveCallback?: (update: Uint8Array) => void;
  private connectionCallback?: (connected: boolean) => void;
  public sentUpdates: Uint8Array[] = [];

  async send(update: Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }
    this.sentUpdates.push(update);
  }

  onReceive(callback: (update: Uint8Array) => void): void {
    this.receiveCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionCallback = callback;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.connectionCallback?.(true);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectionCallback?.(false);
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Test helper methods
  simulateReceive(update: Uint8Array): void {
    if (this.receiveCallback) {
      this.receiveCallback(update);
    }
  }

  simulateConnectionChange(connected: boolean): void {
    this.connected = connected;
    if (this.connectionCallback) {
      this.connectionCallback(connected);
    }
  }

  getSentUpdates(): Uint8Array[] {
    return this.sentUpdates;
  }

  clearSentUpdates(): void {
    this.sentUpdates = [];
  }
}
