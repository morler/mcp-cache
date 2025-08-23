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
- `npm test` - Run Jest test suite
- `npm run test:build` - Build project and run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage reports
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only

### Type Checking & Linting
- `npm run typecheck` - Run TypeScript type checking without compilation
- `npm run lint` - Code linting (not implemented)
- `npm run lint:fix` - Auto-fix linting issues (not implemented)

### Maintenance
- `npm run clean` - Remove build artifacts
- `npm run clean:all` - Remove build artifacts, node_modules, and package-lock.json
- `npm run rebuild` - Clean and rebuild project

## Recent Important Fixes

### MCP Protocol Compatibility Fix
**Issue**: The server was outputting console.log messages to stdout, which interfered with MCP's JSON protocol communication, causing "SyntaxError: Unexpected token" errors.

**Solution**: Implemented a dedicated logging system (`src/logger.ts`) that redirects all logging output to stderr, preserving MCP protocol integrity while maintaining debugging capabilities.

**Files Modified**:
- `src/logger.ts` - New logging system
- `src/CacheManager.ts` - Updated console calls to use logger
- `src/errorHandler.ts` - Updated console calls to use logger  
- `src/configManager.ts` - Updated console calls to use logger
- `src/index.ts` - Updated console calls to use logger
- `src/monitoring.ts` - Updated console calls to use logger

**Key Points**:
- MCP servers must not output anything to stdout except JSON protocol messages
- All debugging/logging output should go to stderr
- This fix ensures the server works properly with MCP clients

## Architecture

### Core Components

1. **CacheManager** (`src/CacheManager.ts`) - Core caching engine with:
   - In-memory storage using JavaScript Map
   - LRU (Least Recently Used) eviction strategy
   - TTL (Time-to-Live) management
   - Memory usage tracking and limits
   - Performance statistics collection
   - Automatic cleanup of expired entries
   - Version-aware caching with dependency tracking
   - Batch operations for improved performance
   - Advanced features like hot keys, preheating, and penetration protection

2. **CacheVersionManager** (`src/CacheVersionManager.ts`) - Version management system:
   - Version-aware data storage and retrieval
   - Dependency tracking and validation
   - Version conflict detection and resolution
   - File system change monitoring
   - Content hash validation

3. **Monitoring System** (`src/monitoring.ts`) - Comprehensive monitoring with:
   - Real-time metrics collection
   - Performance trend analysis
   - Alert system with configurable rules
   - System health monitoring
   - Circuit breakers for failure protection

4. **MemoryCacheServer** (`src/index.ts`) - MCP server implementation with:
   - MCP protocol handling via `@modelcontextprotocol/sdk`
   - Comprehensive tool registration for all cache operations
   - Resource endpoints for cache statistics
   - Configuration management from `config.json` and environment variables
   - Graceful shutdown handling
   - Enterprise-grade features and tools

5. **Utility Components**:
   - **Logger** (`src/logger.ts`) - Stderr-based logging system for MCP compatibility
   - **Memory Utils** (`src/memoryUtils.ts`) - Memory management utilities
   - **Encryption** (`src/encryption.ts`) - Data encryption capabilities
   - **Validators** (`src/validators.ts`) - Input validation system
   - **Error Handler** (`src/errorHandler.ts`) - Comprehensive error handling
   - **Config Manager** (`src/configManager.ts`) - Configuration management
   - **AsyncMutex** (`src/AsyncMutex.ts`) - Async concurrency control

6. **Type Definitions** (`src/types.ts`) - Comprehensive TypeScript interfaces for:
   - `CacheEntry` - Individual cache item structure with version support
   - `CacheStats` - Performance and system metrics
   - `CacheConfig` - Configuration options
   - Alert and monitoring types
   - Version management types
   - System health and performance types

### MCP Tools Available

#### Basic Cache Operations
- `store_data` - Store data with optional TTL
- `retrieve_data` - Retrieve cached data with optional freshness validation
- `clear_cache` - Clear specific cache entry or entire cache
- `get_cache_stats` - Get cache performance statistics

#### Version Management
- `store_data_with_version` - Store data with version awareness and dependency tracking
- `retrieve_data_with_validation` - Retrieve data with version validation and dependency checking
- `get_version_stats` - Get version management statistics
- `check_version_conflicts` - Check for version conflicts in cached data

#### Batch Operations
- `batch_store_data` - Store multiple items in a single operation
- `batch_retrieve_data` - Retrieve multiple items efficiently
- `batch_delete_data` - Delete multiple cache entries

#### Advanced Features
- `get_hot_keys` - Get frequently accessed keys
- `preheat_keys` - Preheat cache with specified keys
- `get_preheating_stats` - Get cache preheating statistics
- `get_with_protection` - Get data with cache penetration protection
- `clear_null_value_cache` - Clear null value cache entries
- `get_penetration_stats` - Get cache penetration protection statistics

#### System Health & Performance
- `get_gc_stats` - Get garbage collection statistics
- `force_gc` - Manually trigger garbage collection
- `set_memory_pressure_thresholds` - Configure memory pressure thresholds
- `get_server_stats` - Get MCP server performance statistics
- `get_error_stats` - Get error handling statistics
- `get_system_health` - Get overall system health status
- `reset_circuit_breakers` - Reset circuit breakers
- `execute_recovery_strategy` - Execute recovery strategy for errors

#### Monitoring & Alerting
- `get_monitoring_metrics` - Get current monitoring metrics
- `get_metrics_history` - Get historical monitoring data
- `get_performance_trends` - Get performance trend analysis
- `get_dashboard_data` - Get comprehensive dashboard data
- `get_active_alerts` - Get currently active alerts
- `get_alert_history` - Get alert history
- `add_alert_rule` - Add new alert rule
- `remove_alert_rule` - Remove alert rule
- `get_alert_rules` - Get all alert rules
- `resolve_alert` - Resolve active alert
- `get_monitoring_health` - Get monitoring system health
- `reset_monitoring_stats` - Reset monitoring statistics

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
- Built with `@modelcontextprotocol/sdk` version 1.17.2
- Jest test suite configured and ready for implementation
- Uses fs-extra for file operations
- Executable permissions set on build output for direct execution

## Recent Development History

### Enterprise Features (Recent Commits)
- **企业级测试套件和功能验证** - Added comprehensive test infrastructure
- **完成MCP缓存服务器企业级功能开发** - Completed enterprise-grade feature development
- **修复MCP工具JSON Schema兼容性问题** - Fixed JSON Schema compatibility issues
- **优化缓存同步机制** - Optimized cache synchronization for high-frequency operations
- **完成MCP缓存服务器核心优化和版本管理功能** - Completed core optimizations and version management

### Key Features Added
1. **Version Management System** - Full version control and dependency tracking
2. **Comprehensive Monitoring** - Real-time metrics, alerts, and health monitoring
3. **Enterprise Batch Operations** - High-performance bulk operations
4. **Advanced Cache Features** - Hot keys, preheating, penetration protection
5. **System Health & Recovery** - Circuit breakers, error recovery, GC management
6. **Professional Logging** - MCP-compatible stderr logging system

### Testing Infrastructure
- Jest testing framework configured
- Test scripts for unit, integration, and coverage testing
- Performance and build testing capabilities
- Watch mode for development testing

### Current Status
- **Version**: 1.0.0
- **Status**: Production-ready with enterprise features
- **MCP Protocol**: Fully compliant with latest MCP SDK
- **Test Coverage**: Framework in place, tests pending implementation
- **Documentation**: Comprehensive and up-to-date