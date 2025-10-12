# Contributing to Sync-Wiser

Thank you for your interest in contributing to Sync-Wiser! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/sync-wiser.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Workflow

### Building

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- src/core/SyncEngine.test.ts
```

### Linting

```bash
npm run lint
```

Fix linting issues automatically where possible:
```bash
npm run lint -- --fix
```

### Running Examples

```bash
# Run the basic example
npx ts-node examples/basic.ts
```

## Code Style

- We use TypeScript for type safety
- Follow existing code patterns and naming conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and small

## Testing Guidelines

- Write tests for all new features
- Maintain or improve code coverage
- Use descriptive test names
- Test edge cases and error conditions
- Use the existing test patterns (Jest)

Example test structure:
```typescript
describe('FeatureName', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  afterEach(async () => {
    await storage.close();
  });

  test('should do something specific', async () => {
    // Arrange
    const engine = new SyncEngine({ docName: 'test', storage });
    
    // Act
    await engine.initialize();
    
    // Assert
    expect(engine.getDoc()).toBeInstanceOf(Y.Doc);
    
    // Cleanup
    await engine.destroy();
  });
});
```

## Pull Request Process

1. **Update Documentation**: Update README.md if you've added features
2. **Add Tests**: Ensure new code has test coverage
3. **Run Tests**: Make sure all tests pass (`npm test`)
4. **Lint Code**: Ensure code passes linting (`npm run lint`)
5. **Build**: Verify the build succeeds (`npm run build`)
6. **Commit Messages**: Write clear, descriptive commit messages
7. **Create PR**: Submit a pull request with a clear description

### Commit Message Format

```
type: short description

Longer description if needed

Fixes #123
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks

## Adding New Features

### Adding a Storage Adapter

1. Create a new file in `src/storage/`
2. Implement the `StorageAdapter` interface
3. Add tests in `src/storage/YourAdapter.test.ts`
4. Export from `src/index.ts`
5. Document in README.md

Example:
```typescript
import { StorageAdapter } from '../core/types';

export class MyStorageAdapter implements StorageAdapter {
  async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    // Implementation
  }
  
  // ... implement other methods
}
```

### Adding a Transport Adapter

1. Create a new file in `src/transports/`
2. Implement the `TransportAdapter` interface
3. Add tests
4. Export from `src/index.ts`
5. Document in README.md

### Adding a Crypto Adapter

1. Create implementation in `src/crypto/`
2. Implement the `CryptoAdapter` interface
3. Add tests
4. Export from `src/index.ts`
5. Document in README.md

## Project Structure

```
sync-wiser/
├── src/
│   ├── core/           # Core SyncEngine and types
│   ├── storage/        # Storage adapter implementations
│   ├── transports/     # Transport adapter implementations
│   ├── crypto/         # Crypto adapter implementations
│   └── index.ts        # Public API exports
├── examples/           # Usage examples
├── dist/              # Compiled output (gitignored)
└── package.json
```

## Questions or Issues?

- Open an issue for bugs or feature requests
- Use discussions for questions
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
