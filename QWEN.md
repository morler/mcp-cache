# Qwen Code Context for MCP Memory Cache Server

## Project Overview

This is a TypeScript-based Model Context Protocol (MCP) server designed to reduce token consumption by efficiently caching data between language model interactions. It provides advanced caching mechanisms including:

- Smart cache management with LRU eviction and precise memory calculation
- Version-aware caching with dependency tracking to prevent stale data issues
- Batch operations for efficient data handling
- Cache preheating for frequently accessed data
- Enterprise-grade security features including AES-256-GCM encryption and access control
- Cache penetration protection
- Comprehensive monitoring and performance analytics

The server is built with TypeScript, uses Node.js for runtime, and leverages the `@modelcontextprotocol/sdk` for MCP integration.

## Building and Running

### Prerequisites

- Node.js (version not specified, but ES Modules are used)
- npm (Node Package Manager)

### Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Build the Project**:
   ```bash
   npm run build
   ```
   This compiles the TypeScript code in `src/` to JavaScript in the `build/` directory.

### Running the Server

To start the MCP server:
```bash
npm run start
# or
node build/index.js
```

The server communicates over stdio and is intended to be launched by an MCP client.

### Development

- **Compile TypeScript in Watch Mode**:
  ```bash
  npm run dev
  ```
- **Clean Build Directory**:
  ```bash
  npm run clean
  ```

## Testing

The project uses Jest for testing.

- **Run All Tests**:
  ```bash
  npm test
  ```
- **Run Tests in Watch Mode**:
  ```bash
  npm run test:watch
  ```
- **Run Tests with Coverage**:
  ```bash
  npm run test:coverage
  ```
- **Run Unit Tests**:
  ```bash
  npm run test:unit
  ```
- **Run Integration Tests**:
  ```bash
  npm run test:integration
  ```

Configuration for Jest is in `jest.config.json`.

## Key Source Files

- `src/CacheManager.ts`: The core caching logic, including LRU management, memory calculations, version awareness, encryption, and batch operations.
- `src/CacheVersionManager.ts`: Handles validation of cached entries based on TTL, content hashes, and file dependencies.
- `src/AsyncMutex.ts`: Provides asynchronous mutual exclusion for concurrency safety.
- `src/errorHandler.ts`: Implements error handling with circuit breakers and retry mechanisms.
- `src/encryption.ts`: Manages data encryption and access control.
- `src/memoryUtils.ts`: Utilities for calculating memory usage of cached items.

## Configuration

The server is configured via `config.json` or environment variables. Key settings include:

- `maxEntries`: Maximum number of cache items (default: 1000)
- `maxMemory`: Maximum memory usage in bytes (default: 100MB)
- `defaultTTL`: Default time-to-live for entries in seconds (default: 3600)
- `checkInterval`: Interval for cleaning expired entries (default: 60000ms)
- `statsInterval`: Interval for updating cache statistics (default: 30000ms)
- `preciseMemoryCalculation`: Enables detailed memory usage tracking (default: false)
- `versionAwareMode`: Enables file dependency tracking and version management (default: false)
- `encryptionEnabled`: Enables data encryption (default: false)
- `encryptionKey`: Custom AES encryption key (auto-generated if not provided)
- `sensitivePatterns`: Regex patterns for data that should be encrypted
- `accessControl`: Defines allowed operations and restricted keys/patterns

Environment variables can override these settings (e.g., `MAX_ENTRIES`, `MAX_MEMORY`).

## Development Conventions

- **Language**: TypeScript with strict type checking (`tsconfig.json`).
- **Module System**: ES Modules.
- **Testing**: Jest for unit and integration tests. Tests are likely colocated with source files or in a `tests/` directory.
- **Code Style**: The project uses ESLint and Prettier (as mentioned in `README.md`), although the configuration files are not present in the provided structure. Future contributors should adhere to these tools once configured.
- **Documentation**: Key documentation is in `README.md` and `CLAUDE.md`. Code should be self-documenting with JSDoc comments where necessary.
- **Error Handling**: Centralized error handling with custom error codes and circuit breakers.

## Available MCP Tools

The server exposes numerous tools for cache management, versioning, batch operations, preheating, security, error handling, and monitoring. These are detailed in the `README.md` under the "Available MCP Tools" section.

### Note on Tool Schema Fixes

In a previous version, some tools (`store_data`, `store_data_with_version`, `batch_store_data`) had incomplete `inputSchema` definitions where the `value` field was missing a `type` property. This caused MCP clients to skip these tools with warnings about missing types. The issue has been fixed by adding proper type definitions (`['string', 'number', 'boolean', 'object', 'array', 'null']`) to these fields.
