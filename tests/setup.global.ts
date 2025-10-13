export default async function globalSetup() {
  if (typeof ArrayBuffer !== 'undefined') {
    const descriptor = Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      'resizable'
    );
    if (!descriptor || typeof descriptor.get !== 'function') {
      Object.defineProperty(ArrayBuffer.prototype, 'resizable', {
        configurable: true,
        enumerable: false,
        get() {
          return false;
        },
      });
    }
  }

  if (typeof SharedArrayBuffer !== 'undefined') {
    const descriptor = Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      'growable'
    );
    if (!descriptor || typeof descriptor.get !== 'function') {
      Object.defineProperty(SharedArrayBuffer.prototype, 'growable', {
        configurable: true,
        enumerable: false,
        get() {
          return false;
        },
      });
    }
  }
}
