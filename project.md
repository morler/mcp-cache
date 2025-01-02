# Charly Memory Cache Server

## Overview
An MCP (Model Context Protocol) server implementation designed to optimize memory usage and reduce token consumption in AI interactions. The server provides efficient caching mechanisms for file contents and computation results, with features like TTL support, LRU eviction, and real-time performance monitoring.

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd charly-memory-cache-server
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Add to MCP settings (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "memory-cache": {
      "command": "node",
      "args": ["/path/to/charly-memory-cache-server/build/index.js"]
    }
  }
}
```

## Technical Architecture

### Core Components

#### 1. Cache Manager
The `CacheManager` class provides the core caching functionality:

```typescript
class CacheManager {
  // Core methods
  set(key: string, value: any, ttl?: number): void
  get(key: string): any
  delete(key: string): boolean
  clear(): void
  getStats(): CacheStats
  
  // Internal methods
  private evictStale(): void
  private enforceMemoryLimit(requiredSize: number): void
  private calculateSize(value: any): number
  private updateStats(): void
}
```

#### 2. Cache Entry Structure
```typescript
interface CacheEntry {
  value: any;          // The cached data
  created: number;     // Timestamp when entry was created
  lastAccessed: number;// Timestamp of last access (for LRU)
  ttl?: number;        // Time-to-live in seconds
  size: number;        // Approximate size in bytes
}
```

#### 3. Cache Statistics
```typescript
interface CacheStats {
  totalEntries: number;  // Current number of cached items
  memoryUsage: number;   // Approximate memory usage in bytes
  hits: number;          // Cache hit count
  misses: number;        // Cache miss count
  hitRate: number;       // Hit rate percentage
  avgAccessTime: number; // Average access time in milliseconds
}
```

### Memory Management

1. **Size Calculation**
   - Uses JSON.stringify length * 2 for UTF-16 encoding
   - Provides approximate memory usage estimation
   - Conservative approach to prevent memory overuse

2. **Eviction Policies**
   - TTL (Time-To-Live) based expiration
   - LRU (Least Recently Used) when memory limit is reached
   - Automatic cleanup of expired entries

3. **Memory Limits**
   - Configurable maximum entries
   - Configurable maximum memory usage
   - Automatic enforcement of limits

## API Documentation

### MCP Tools

#### 1. store_data
Store data in the cache with optional TTL.

```typescript
// Input Schema
interface StoreDataInput {
  key: string;    // Unique identifier
  value: any;     // Data to cache
  ttl?: number;   // Time-to-live in seconds
}

// Example
await server.callTool('store_data', {
  key: 'user:123',
  value: { name: 'John', age: 30 },
  ttl: 3600 // 1 hour
});
```

#### 2. retrieve_data
Retrieve cached data by key.

```typescript
// Input Schema
interface RetrieveDataInput {
  key: string;    // Cache key to retrieve
}

// Example
const data = await server.callTool('retrieve_data', {
  key: 'user:123'
});
```

#### 3. clear_cache
Clear specific or all cache entries.

```typescript
// Input Schema
interface ClearCacheInput {
  key?: string;   // Optional specific key to clear
}

// Examples
// Clear specific entry
await server.callTool('clear_cache', {
  key: 'user:123'
});

// Clear all entries
await server.callTool('clear_cache', {});
```

#### 4. get_cache_stats
Get current cache statistics.

```typescript
// Example
const stats = await server.callTool('get_cache_stats', {});
console.log(stats);
// {
//   totalEntries: 10,
//   memoryUsage: 5242880, // 5MB
//   hits: 150,
//   misses: 30,
//   hitRate: 83.33,
//   avgAccessTime: 0.5
// }
```

### MCP Resources

#### Cache Statistics Resource
URI: `cache://stats`
- Provides real-time cache performance metrics
- Returns same data as get_cache_stats tool
- Useful for monitoring and diagnostics

```typescript
// Example resource access
const stats = await server.readResource('cache://stats');
```

## Configuration

The cache behavior can be customized through the `CacheConfig` interface:

```typescript
interface CacheConfig {
  maxEntries?: number;    // Maximum number of cache entries (default: 1000)
  maxMemory?: number;     // Maximum memory usage in bytes (default: 100MB)
  defaultTTL?: number;    // Default TTL in seconds (default: 3600)
  checkInterval?: number; // Cleanup interval in ms (default: 60000)
  statsInterval?: number; // Stats update interval in ms (default: 30000)
}
```

Example configuration:
```typescript
const cacheManager = new CacheManager({
  maxEntries: 5000,
  maxMemory: 200 * 1024 * 1024, // 200MB
  defaultTTL: 7200, // 2 hours
  checkInterval: 120000, // 2 minutes
  statsInterval: 60000 // 1 minute
});
```

## Best Practices

1. **Key Naming**
   - Use descriptive, hierarchical keys (e.g., 'user:123', 'file:/path/to/file')
   - Include version or type information if needed
   - Keep keys reasonably short to minimize memory overhead

2. **TTL Usage**
   - Set appropriate TTLs based on data volatility
   - Use shorter TTLs for frequently changing data
   - Consider using infinite TTL for static content

3. **Memory Management**
   - Monitor cache statistics regularly
   - Adjust maxMemory based on system resources
   - Consider data size when setting cache limits

4. **Error Handling**
   - Always handle potential cache misses
   - Implement fallback mechanisms for critical data
   - Monitor and log cache errors

## Troubleshooting

### Common Issues

1. **High Miss Rate**
   - Check if TTLs are too short
   - Verify cache size limits
   - Monitor eviction patterns

2. **Memory Issues**
   - Reduce maxMemory setting
   - Decrease defaultTTL
   - Implement more aggressive eviction

3. **Slow Performance**
   - Check average access times
   - Monitor system memory usage
   - Verify data serialization efficiency

### Debugging

1. **Enable Debug Logging**
   ```typescript
   const cacheManager = new CacheManager({
     ...config,
     debug: true
   });
   ```

2. **Monitor Statistics**
   - Use get_cache_stats regularly
   - Track hit/miss ratios
   - Monitor memory usage trends

3. **Check Resource Usage**
   - Use cache://stats resource
   - Monitor system memory
   - Track cache size over time

## Future Enhancements

1. **Persistence Layer**
   - Disk-based backup
   - Recovery mechanisms
   - Cache warming

2. **Advanced Features**
   - Pattern-based key invalidation
   - Cache event listeners
   - Custom eviction policies

3. **Monitoring**
   - Detailed metrics
   - Performance analytics
   - Health checks

4. **Distribution**
   - Multi-process support
   - Cluster synchronization
   - Distributed caching
