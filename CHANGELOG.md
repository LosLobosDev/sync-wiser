# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-12

### Added
- Initial release of sync-wiser
- Core `SyncEngine` for managing Yjs documents
- Storage adapter interface and implementations:
  - `MemoryStorageAdapter` for in-memory storage
  - `IndexedDBStorageAdapter` for browser persistence
- Transport adapter interface and implementations:
  - `WebSocketTransportAdapter` for WebSocket connections
  - `MockTransportAdapter` for testing
- Crypto adapter interface with compression support:
  - `CompressionCryptoAdapter` for data compression
  - `NoOpCryptoAdapter` for passthrough
- Automatic snapshot management
- Offline-first architecture
- Comprehensive test suite (18 tests)
- Documentation and examples
- TypeScript declarations

### Features
- ⚡ Offline-first sync with replayable updates and snapshots
- 🔄 Transport-agnostic architecture (works with SignalR, WebSocket, etc.)
- 💾 Durable storage adapters for SQLite, IndexedDB, or custom backends
- 🔐 Optional encryption/compression layer
- 🧪 Built for deterministic testing and reproducible merges

[1.0.0]: https://github.com/carlosharrycrf/sync-wiser/releases/tag/v1.0.0
