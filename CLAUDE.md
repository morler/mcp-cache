# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that provides memory caching functionality to reduce token consumption in language model interactions. The server acts as a caching layer between MCP clients and language models, automatically storing and retrieving data to avoid redundant processing.

## Development Commands

### Building and Running
- `npm run build` - Compile TypeScript to JavaScript in `build/` directory and set executable permissions
- `npm run start` - Run the compiled server from `build/index.js`
- `npm run dev` - Run TypeScript compiler in watch mode for development
- `npm run prepare` - Build the project (automatically runs on npm install)

### Testing
- `npm test` - Currently returns "no test specified" (test suite not implemented)

## Architecture

### Core Components

1. **CacheManager** (`src/CacheManager.ts`) - Core caching engine with:
   - In-memory storage using JavaScript Map
   - LRU (Least Recently Used) eviction strategy
   - TTL (Time-to-Live) management
   - Memory usage tracking and limits
   - Performance statistics collection
   - Automatic cleanup of expired entries

2. **MemoryCacheServer** (`src/index.ts`) - MCP server implementation with:
   - MCP protocol handling via `@modelcontextprotocol/sdk`
   - Tool registration for cache operations
   - Resource endpoints for cache statistics
   - Configuration management from `config.json` and environment variables
   - Graceful shutdown handling

3. **Type Definitions** (`src/types.ts`) - TypeScript interfaces for:
   - `CacheEntry` - Individual cache item structure
   - `CacheStats` - Performance metrics
   - `CacheConfig` - Configuration options

### MCP Tools Available

- `store_data` - Store data with optional TTL
- `retrieve_data` - Retrieve cached data by key
- `clear_cache` - Clear specific cache entry or entire cache
- `get_cache_stats` - Get cache performance statistics

### MCP Resources Available

- `cache://stats` - Real-time cache performance metrics in JSON format

## Configuration

The server loads configuration from `config.json` with environment variable overrides:

- `maxEntries` - Maximum cache entries (default: 1000)
- `maxMemory` - Maximum memory usage in bytes (default: 100MB)
- `defaultTTL` - Default time-to-live in seconds (default: 3600)
- `checkInterval` - Cleanup interval in milliseconds (default: 60000)
- `statsInterval` - Stats update interval in milliseconds (default: 30000)

Environment variables: `MAX_ENTRIES`, `MAX_MEMORY`, `DEFAULT_TTL`, `CHECK_INTERVAL`, `STATS_INTERVAL`, `CONFIG_PATH`

## Key Implementation Details

### Memory Management
- Uses JSON.stringify() for rough memory size estimation
- Implements LRU eviction when memory limits are reached
- Automatic cleanup of expired entries on configurable intervals

### Performance Tracking
- Tracks hit/miss rates and average access times
- Real-time statistics available via MCP resource
- Performance monitoring for optimization

### Error Handling
- Graceful degradation when memory limits are exceeded
- Proper error propagation through MCP protocol
- Automatic cleanup on server shutdown

## Development Notes

- Uses ES2020 modules with strict TypeScript configuration
- Built with `@modelcontextprotocol/sdk` version 0.6.0
- No test suite currently implemented
- Uses fs-extra for file operations
- Executable permissions set on build output for direct execution