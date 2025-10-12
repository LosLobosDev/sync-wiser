import { CryptoAdapter } from '../core/types';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

/**
 * Simple compression crypto adapter using lib0
 * For production use, add proper encryption with a library like crypto-js
 */
export class CompressionCryptoAdapter implements CryptoAdapter {
  async encrypt(data: Uint8Array): Promise<Uint8Array> {
    // For now, just compress using lib0
    const encoder = encoding.createEncoder();
    encoding.writeVarUint8Array(encoder, data);
    return encoding.toUint8Array(encoder);
  }

  async decrypt(data: Uint8Array): Promise<Uint8Array> {
    const decoder = decoding.createDecoder(data);
    return decoding.readVarUint8Array(decoder);
  }
}

/**
 * No-op crypto adapter (passthrough)
 */
export class NoOpCryptoAdapter implements CryptoAdapter {
  async encrypt(data: Uint8Array): Promise<Uint8Array> {
    return data;
  }

  async decrypt(data: Uint8Array): Promise<Uint8Array> {
    return data;
  }
}
