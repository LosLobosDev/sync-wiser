import { TransportAdapter } from '../core/types';

/**
 * WebSocket transport adapter for real-time sync
 */
export class WebSocketTransportAdapter implements TransportAdapter {
  private ws: WebSocket | null = null;
  private url: string;
  private receiveCallback?: (update: Uint8Array) => void;
  private connectionCallback?: (connected: boolean) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(url: string) {
    this.url = url;
  }

  async send(update: Uint8Array): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    this.ws.send(update);
  }

  onReceive(callback: (update: Uint8Array) => void): void {
    this.receiveCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionCallback = callback;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.connectionCallback?.(true);
          resolve();
        };

        this.ws.onmessage = (event) => {
          const update = new Uint8Array(event.data);
          this.receiveCallback?.(update);
        };

        this.ws.onclose = () => {
          this.connectionCallback?.(false);
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect().catch((error) => {
          console.error('Reconnect failed:', error);
        });
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
