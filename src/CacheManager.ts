import { CacheEntry, CacheStats, CacheConfig } from './types.js';
import { calculateMemoryUsageAdaptive } from './memoryUtils.js';
import { AsyncMutex } from './AsyncMutex.js';

export class CacheManager {
  private cache: Map<string, CacheEntry>;
  private accessOrder: Map<string, { prev?: string; next?: string }>;
  private lruHead?: string;
  private lruTail?: string;
  private stats: CacheStats;
  private config: Required<CacheConfig>;
  private cleanupInterval: ReturnType<typeof setInterval>;
  private statsUpdateInterval: ReturnType<typeof setInterval>;
  private mutex: AsyncMutex;

  constructor(config: CacheConfig = {}) {
    this.cache = new Map();
    this.accessOrder = new Map();
    this.lruHead = undefined;
    this.lruTail = undefined;
    this.mutex = new AsyncMutex();
    this.stats = {
      totalEntries: 0,
      memoryUsage: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      avgAccessTime: 0
    };
    
    // Set default configuration
    this.config = {
      maxEntries: config.maxEntries ?? 1000,
      maxMemory: config.maxMemory ?? 100 * 1024 * 1024, // 100MB default
      defaultTTL: config.defaultTTL ?? 3600, // 1 hour default
      checkInterval: config.checkInterval ?? 60 * 1000, // 1 minute default
      statsInterval: config.statsInterval ?? 30 * 1000, // 30 seconds default
      preciseMemoryCalculation: config.preciseMemoryCalculation ?? false
    };

    // Start maintenance intervals
    this.cleanupInterval = setInterval(() => {
      this.evictStale().catch(err => console.error('清理过期条目时出错:', err));
    }, this.config.checkInterval);
    this.statsUpdateInterval = setInterval(() => this.updateStats(), this.config.statsInterval);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const startTime = performance.now();
      
      // Calculate memory usage using improved method
      const memoryInfo = calculateMemoryUsageAdaptive(key, value, {
        precise: this.config.preciseMemoryCalculation
      });
      const size = memoryInfo.totalSize;
      
      const entry: CacheEntry = {
        value,
        created: Date.now(),
        lastAccessed: Date.now(),
        ttl: ttl ?? this.config.defaultTTL,
        size
      };

      // Check if this is an update to existing entry
      const isUpdate = this.cache.has(key);
      if (isUpdate) {
        const oldEntry = this.cache.get(key)!;
        this.stats.memoryUsage -= oldEntry.size;
      }

      // Check if adding this entry would exceed limits and enforce them
      const effectiveMemoryIncrease = isUpdate ? 0 : size;
      const wouldExceedMemory = this.stats.memoryUsage + effectiveMemoryIncrease > this.config.maxMemory;
      const wouldExceedEntries = !isUpdate && this.cache.size >= this.config.maxEntries;
      
      if (wouldExceedMemory || wouldExceedEntries) {
        await this.enforceMemoryLimit(effectiveMemoryIncrease);
      }

      // Add to LRU tracking for new entry
      if (!isUpdate) {
        this.addToLRUChain(key);
      }
      
      this.cache.set(key, entry);
      this.moveToHead(key);
      this.stats.totalEntries = this.cache.size;
      this.stats.memoryUsage += size;

      const endTime = performance.now();
      this.updateAccessTime(endTime - startTime);
    });
  }

  async get(key: string): Promise<any> {
    return this.mutex.runExclusive(async () => {
      const startTime = performance.now();
      const entry = this.cache.get(key);

      if (!entry) {
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }

      // Check if entry has expired
      if (this.isExpired(entry)) {
        await this.delete(key);
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }

      // Update last accessed time and move to head of LRU chain
      entry.lastAccessed = Date.now();
      this.moveToHead(key);
      this.stats.hits++;
      this.updateHitRate();

      const endTime = performance.now();
      this.updateAccessTime(endTime - startTime);

      return entry.value;
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const entry = this.cache.get(key);
      if (entry) {
        this.stats.memoryUsage -= entry.size;
        this.cache.delete(key);
        this.removeFromLRUChain(key);
        this.stats.totalEntries = this.cache.size;
        return true;
      }
      return false;
    });
  }

  async clear(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.cache.clear();
      this.accessOrder.clear();
      this.lruHead = undefined;
      this.lruTail = undefined;
      this.resetStats();
    });
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.created + (entry.ttl ?? this.config.defaultTTL) * 1000;
  }

  private async evictStale(): Promise<void> {
    // 收集过期的键，避免在遍历时修改Map
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        expiredKeys.push(key);
      }
    }
    
    // 异步删除过期条目
    for (const key of expiredKeys) {
      await this.delete(key);
    }
  }

  private async enforceMemoryLimit(requiredSize: number): Promise<void> {
    // Use optimized LRU strategy - remove from tail (least recently used)
    while (this.stats.memoryUsage + requiredSize > this.config.maxMemory && this.lruTail) {
      const keyToRemove = this.lruTail;
      this.deleteInternal(keyToRemove);
    }
    
    // Also check entry count limit
    while (this.cache.size >= this.config.maxEntries && this.lruTail) {
      const keyToRemove = this.lruTail;
      this.deleteInternal(keyToRemove);
    }
  }

  private deleteInternal(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.stats.memoryUsage -= entry.size;
      this.cache.delete(key);
      this.removeFromLRUChain(key);
      this.stats.totalEntries = this.cache.size;
      return true;
    }
    return false;
  }

  private calculateSize(value: any): number {
    // 保留旧方法作为备用，但现在主要使用memoryUtils中的方法
    const str = JSON.stringify(value);
    return str.length * 2; // Approximate UTF-16 encoding size
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  private updateAccessTime(duration: number): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.avgAccessTime = 
      ((this.stats.avgAccessTime * (total - 1)) + duration) / total;
  }

  private resetStats(): void {
    this.stats = {
      totalEntries: 0,
      memoryUsage: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      avgAccessTime: 0
    };
  }

  private addToLRUChain(key: string): void {
    this.accessOrder.set(key, {});
    if (!this.lruHead) {
      this.lruHead = key;
      this.lruTail = key;
    }
  }

  private removeFromLRUChain(key: string): void {
    const node = this.accessOrder.get(key);
    if (!node) return;

    const { prev, next } = node;
    
    // Update previous node's next pointer
    if (prev) {
      const prevNode = this.accessOrder.get(prev);
      if (prevNode) prevNode.next = next;
    } else {
      this.lruHead = next;
    }
    
    // Update next node's previous pointer
    if (next) {
      const nextNode = this.accessOrder.get(next);
      if (nextNode) nextNode.prev = prev;
    } else {
      this.lruTail = prev;
    }
    
    this.accessOrder.delete(key);
  }

  private moveToHead(key: string): void {
    if (this.lruHead === key) return; // Already at head
    
    // Remove from current position
    const node = this.accessOrder.get(key);
    if (!node) return;
    
    const { prev, next } = node;
    
    // Update connections
    if (prev) {
      const prevNode = this.accessOrder.get(prev);
      if (prevNode) prevNode.next = next;
    }
    
    if (next) {
      const nextNode = this.accessOrder.get(next);
      if (nextNode) nextNode.prev = prev;
    } else {
      this.lruTail = prev; // This was the tail
    }
    
    // Move to head
    node.prev = undefined;
    node.next = this.lruHead;
    
    if (this.lruHead) {
      const headNode = this.accessOrder.get(this.lruHead);
      if (headNode) headNode.prev = key;
    }
    
    this.lruHead = key;
    
    // If this was the only element, it's also the tail
    if (!this.lruTail) {
      this.lruTail = key;
    }
  }

  private updateStats(): void {
    // Additional periodic stats updates could be added here
    this.updateHitRate();
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.statsUpdateInterval) clearInterval(this.statsUpdateInterval);
    await this.clear();
  }
}
