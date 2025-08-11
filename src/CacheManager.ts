import { CacheEntry, CacheStats, CacheConfig } from './types.js';
import { calculateMemoryUsageAdaptive } from './memoryUtils.js';
import { AsyncMutex } from './AsyncMutex.js';
import { CacheError, CacheErrorCode, ErrorHandler } from './errorHandler.js';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';

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
  
  // 版本管理相关
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();
  private versionAwareMode: boolean = false;

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
      preciseMemoryCalculation: config.preciseMemoryCalculation ?? false,
      versionAwareMode: config.versionAwareMode ?? false
    };
    
    // 启用版本感知模式
    this.versionAwareMode = this.config.versionAwareMode;

    // Start maintenance intervals
    this.cleanupInterval = setInterval(() => {
      this.evictStale().catch(err => console.error('清理过期条目时出错:', err));
    }, this.config.checkInterval);
    this.statsUpdateInterval = setInterval(() => this.updateStats(), this.config.statsInterval);
  }

  async set(key: string, value: any, ttl?: number, options?: {
    version?: string;
    dependencies?: string[];
    sourceFile?: string;
  }): Promise<void> {
    return this.mutex.runExclusive(async () => {
      try {
        // 输入验证
        if (!key || typeof key !== 'string') {
          throw CacheError.createError(
            CacheErrorCode.INVALID_INPUT,
            'Invalid key: must be a non-empty string',
            { key, operation: 'set' }
          );
        }
        
        if (value === undefined) {
          throw CacheError.createError(
            CacheErrorCode.INVALID_INPUT,
            'Invalid value: cannot be undefined',
            { key, operation: 'set' }
          );
        }
        
        const startTime = performance.now();
        
        // 版本感知模式处理
        let finalKey = key;
        let finalValue = value;
        
        if (this.versionAwareMode && options) {
          const { version, dependencies = [], sourceFile } = options;
          
          // 生成内容哈希
          const contentHash = this.generateHash(value);
          
          // 使用时间戳作为版本标识
          const timestamp = version || Date.now().toString();
          
          // 创建带版本信息的键
          finalKey = this.createVersionedKey(key, timestamp);
          
          // 设置依赖监控
          if (sourceFile && dependencies.length > 0) {
            await this.setupDependencyWatching(finalKey, sourceFile, dependencies);
          }
          
          // 清理旧版本
          await this.cleanupOldVersions(key, timestamp);
        }
        
        // Calculate memory usage using improved method
        const memoryInfo = calculateMemoryUsageAdaptive(finalKey, finalValue, {
          precise: this.config.preciseMemoryCalculation
        });
        const size = memoryInfo.totalSize;
        
        const entry: CacheEntry = {
          value: finalValue,
          created: Date.now(),
          lastAccessed: Date.now(),
          ttl: ttl ?? this.config.defaultTTL,
          size
        };
        
        // 添加版本信息和文件信息
        if (this.versionAwareMode && options) {
          const { version, dependencies = [], sourceFile } = options;
          const timestamp = version || Date.now().toString();
          entry.version = timestamp;
          entry.hash = this.generateHash(finalValue);
          entry.dependencies = dependencies;
          
          // 添加文件时间戳信息
          if (sourceFile) {
            entry.sourceFile = sourceFile;
            entry.fileTimestamp = await this.getFileTimestamp(sourceFile);
          }
        }

        // Check if this is an update to existing entry
        const isUpdate = this.cache.has(finalKey);
        if (isUpdate) {
          const oldEntry = this.cache.get(finalKey)!;
          this.stats.memoryUsage -= oldEntry.size;
        }

        // Check if adding this entry would exceed limits and enforce them
        const effectiveMemoryIncrease = isUpdate ? 0 : size;
        const wouldExceedMemory = this.stats.memoryUsage + effectiveMemoryIncrease > this.config.maxMemory;
        const wouldExceedEntries = !isUpdate && this.cache.size >= this.config.maxEntries;
        
        if (wouldExceedMemory || wouldExceedEntries) {
          try {
            await this.enforceMemoryLimit(effectiveMemoryIncrease);
          } catch (error) {
            if (ErrorHandler.isErrorCode(error, CacheErrorCode.MEMORY_LIMIT_EXCEEDED)) {
              throw error;
            }
            throw CacheError.createError(
              CacheErrorCode.MEMORY_LIMIT_EXCEEDED,
              'Unable to enforce memory limit, cache is full',
              { 
                currentMemory: this.stats.memoryUsage, 
                maxMemory: this.config.maxMemory,
                requiredSize: effectiveMemoryIncrease
              }
            );
          }
        }

        // Add to LRU tracking for new entry
        if (!isUpdate) {
          this.addToLRUChain(finalKey);
        }
        
        this.cache.set(finalKey, entry);
        this.moveToHead(finalKey);
        this.stats.totalEntries = this.cache.size;
        this.stats.memoryUsage += size;

        const endTime = performance.now();
        this.updateAccessTime(endTime - startTime);
      } catch (error) {
        if (ErrorHandler.isCacheError(error)) {
          throw error;
        }
        throw CacheError.createError(
          CacheErrorCode.UNKNOWN_ERROR,
          `Failed to set cache entry: ${ErrorHandler.formatError(error)}`,
          { key, operation: 'set' }
        );
      }
    });
  }

  async get(key: string, options?: {
    version?: string;
    validateDependencies?: boolean;
  }): Promise<any> {
    return this.mutex.runExclusive(async () => {
      const startTime = performance.now();
      
      // 版本感知模式处理
      let finalKey = key;
      let shouldValidate = false;
      
      if (this.versionAwareMode && options) {
        const { version, validateDependencies = true } = options;
        shouldValidate = validateDependencies;
        
        // 尝试获取指定版本或当前版本
        const timestamp = version || Date.now().toString();
        finalKey = this.createVersionedKey(key, timestamp);
        
        // 如果指定版本不存在，尝试获取最新的可用版本
        if (!this.cache.has(finalKey)) {
          return this.getLatestVersionEntry(key);
        }
      }
      
      const entry = this.cache.get(finalKey);

      if (!entry) {
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }

      // Check if entry has expired
      if (this.isExpired(entry)) {
        await this.delete(finalKey);
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }
      
      // 验证文件时间戳
      const isFileValid = await this.validateFileTimestamp(entry);
      if (!isFileValid) {
        await this.delete(finalKey);
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }
      
      // 验证依赖文件是否发生变化
      if (shouldValidate && entry.dependencies) {
        const dependencyChanged = await this.checkDependencyChanges(entry);
        if (dependencyChanged) {
          // 依赖发生变化，使缓存失效
          await this.delete(finalKey);
          this.stats.misses++;
          this.updateHitRate();
          return undefined;
        }
      }

      // Update last accessed time and move to head of LRU chain
      entry.lastAccessed = Date.now();
      this.moveToHead(finalKey);
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
    
    // 清理版本管理相关资源
    if (this.versionAwareMode) {
      await this.destroyVersionManagement();
    }
    
    await this.clear();
  }
  
  // 版本管理相关方法
  private async destroyVersionManagement(): Promise<void> {
    // 关闭所有文件监控器
    for (const [filePath, watcher] of this.fileWatchers) {
      try {
        watcher.close();
      } catch (error) {
        console.warn(`关闭文件监控器 ${filePath} 时出错:`, error);
      }
    }
    
    this.fileWatchers.clear();
    this.dependencyGraph.clear();
  }
  
  /**
   * 创建版本化的缓存键
   */
  private createVersionedKey(baseKey: string, version: string): string {
    return `${baseKey}@${version}`;
  }
  
  /**
   * 生成内容哈希
   */
  private generateHash(value: any): string {
    const content = JSON.stringify(value);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
  
  
  /**
   * 验证缓存条目的文件是否仍然有效
   */
  private async validateFileTimestamp(entry: CacheEntry): Promise<boolean> {
    if (!entry.sourceFile || !entry.fileTimestamp) {
      return true; // 没有文件信息的条目默认有效
    }
    
    try {
      const stats = await fs.stat(entry.sourceFile);
      return stats.mtime.getTime() <= entry.fileTimestamp;
    } catch (error) {
      // 文件不存在或无法访问，认为缓存无效
      return false;
    }
  }

  /**
   * 获取文件修改时间戳
   */
  private async getFileTimestamp(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.mtime.getTime();
    } catch (error) {
      return Date.now();
    }
  }

  /**
   * 验证缓存条目的内容哈希
   */
  private validateContentHash(entry: CacheEntry, currentContent: any): boolean {
    if (!entry.hash) return true;
    
    const currentHash = this.generateHash(currentContent);
    return entry.hash === currentHash;
  }

  /**
   * 为新的set操作验证是否存在内容冲突
   */
  private async validateSetOperation(key: string, newContent: any, options?: {
    version?: string;
    sourceFile?: string;
    validateContent?: boolean;
  }): Promise<{ isValid: boolean; reason?: string }> {
    const existingEntry = this.cache.get(key);
    
    if (!existingEntry || !options?.validateContent) {
      return { isValid: true };
    }
    
    // 检查文件时间戳
    const isFileValid = await this.validateFileTimestamp(existingEntry);
    if (!isFileValid) {
      return { 
        isValid: false, 
        reason: '源文件已被修改，缓存可能过期' 
      };
    }
    
    // 检查内容哈希
    const isContentSame = this.validateContentHash(existingEntry, newContent);
    if (!isContentSame && existingEntry.sourceFile === options.sourceFile) {
      return { 
        isValid: false, 
        reason: '相同源文件的内容不一致，可能存在并发修改' 
      };
    }
    
    return { isValid: true };
  }

  /**
   * 设置依赖文件监控
   */
  private async setupDependencyWatching(
    cacheKey: string, 
    sourceFile: string, 
    dependencies: string[]
  ): Promise<void> {
    const allFiles = [sourceFile, ...dependencies];
    
    for (const filePath of allFiles) {
      if (this.fileWatchers.has(filePath)) continue;
      
      try {
        if (await fs.pathExists(filePath)) {
          const watcher = fs.watch(filePath, (eventType, filename) => {
            // 只处理修改事件，忽略其他事件
            if (eventType === 'change') {
              console.log(`文件 ${filePath} 发生变化，清理相关缓存`);
              this.invalidateDependentCaches(filePath);
            }
          });
          
          this.fileWatchers.set(filePath, watcher);
          
          // 更新依赖图
          if (!this.dependencyGraph.has(filePath)) {
            this.dependencyGraph.set(filePath, new Set());
          }
          this.dependencyGraph.get(filePath)!.add(cacheKey);
        }
      } catch (error) {
        console.warn(`无法监控文件 ${filePath}:`, error);
      }
    }
  }
  
  /**
   * 检查依赖文件是否发生变化
   */
  private async checkDependencyChanges(entry: CacheEntry): Promise<boolean> {
    if (!entry.dependencies) return false;
    
    for (const depPath of entry.dependencies) {
      try {
        const stats = await fs.stat(depPath);
        // 如果文件修改时间晚于缓存创建时间，说明依赖发生了变化
        if (stats.mtime.getTime() > entry.created) {
          return true;
        }
      } catch (error) {
        // 文件不存在或无法访问，认为依赖发生了变化
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 获取最新版本的缓存条目
   */
  private async getLatestVersionEntry(baseKey: string): Promise<any> {
    let latestEntry: CacheEntry | undefined;
    let latestKey: string | undefined;
    let latestCreated = 0;
    
    // 遍历所有缓存条目，找到最新的版本
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(`${baseKey}@`) && entry.created > latestCreated) {
        latestEntry = entry;
        latestKey = key;
        latestCreated = entry.created;
      }
    }
    
    if (latestKey && latestEntry) {
      // 验证依赖
      if (latestEntry.dependencies) {
        const dependencyChanged = await this.checkDependencyChanges(latestEntry);
        if (dependencyChanged) {
          await this.delete(latestKey);
          return undefined;
        }
      }
      
      return latestEntry.value;
    }
    
    return undefined;
  }
  
  /**
   * 清理指定键的旧版本
   */
  private async cleanupOldVersions(baseKey: string, currentVersion: string): Promise<void> {
    const keysToDelete: string[] = [];
    
    // 收集需要删除的旧版本键
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${baseKey}@`) && !key.endsWith(`@${currentVersion}`)) {
        keysToDelete.push(key);
      }
    }
    
    // 删除旧版本（保留最近的2个版本）
    keysToDelete.sort().slice(0, -2).forEach(key => {
      this.deleteInternal(key);
    });
  }
  
  /**
   * 当依赖文件变化时，使相关缓存失效
   */
  private invalidateDependentCaches(filePath: string): void {
    const dependentCaches = this.dependencyGraph.get(filePath);
    if (dependentCaches) {
      console.log(`清理依赖文件 ${filePath} 的 ${dependentCaches.size} 个相关缓存`);
      for (const cacheKey of dependentCaches) {
        this.deleteInternal(cacheKey);
      }
      // 清理依赖关系
      dependentCaches.clear();
    }
  }

  /**
   * 主动设置文件监听（用于单个文件）
   */
  async setupFileWatcher(filePath: string, cacheKey?: string): Promise<boolean> {
    if (this.fileWatchers.has(filePath)) {
      return true; // 已经在监听
    }

    try {
      if (await fs.pathExists(filePath)) {
        const watcher = fs.watch(filePath, (eventType, filename) => {
          if (eventType === 'change') {
            console.log(`监听到文件 ${filePath} 变化`);
            this.invalidateDependentCaches(filePath);
          }
        });

        this.fileWatchers.set(filePath, watcher);

        // 如果指定了缓存键，更新依赖图
        if (cacheKey) {
          if (!this.dependencyGraph.has(filePath)) {
            this.dependencyGraph.set(filePath, new Set());
          }
          this.dependencyGraph.get(filePath)!.add(cacheKey);
        }

        return true;
      }
    } catch (error) {
      console.warn(`设置文件监听失败 ${filePath}:`, error);
    }

    return false;
  }

  /**
   * 停止文件监听
   */
  stopFileWatcher(filePath: string): void {
    const watcher = this.fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(filePath);
      this.dependencyGraph.delete(filePath);
      console.log(`停止监听文件: ${filePath}`);
    }
  }
  
  /**
   * 获取版本管理状态
   */
  isVersionAware(): boolean {
    return this.versionAwareMode;
  }
  
  /**
   * 获取版本统计信息
   */
  getVersionStats(): {
    totalVersions: number;
    activeWatchers: number;
    dependencyGraphSize: number;
  } {
    return {
      totalVersions: Array.from(this.cache.keys()).filter(key => key.includes('@')).length,
      activeWatchers: this.fileWatchers.size,
      dependencyGraphSize: this.dependencyGraph.size
    };
  }

  // 批量操作相关方法
  /**
   * 批量设置缓存条目
   */
  async setMany(items: Array<{
    key: string;
    value: any;
    ttl?: number;
    options?: {
      version?: string;
      dependencies?: string[];
      sourceFile?: string;
    };
  }>): Promise<{
    success: string[];
    failed: Array<{ key: string; error: string }>;
  }> {
    return this.mutex.runExclusive(async () => {
      const result = {
        success: [] as string[],
        failed: [] as Array<{ key: string; error: string }>
      };

      for (const item of items) {
        try {
          await this.set(item.key, item.value, item.ttl, item.options);
          result.success.push(item.key);
        } catch (error) {
          result.failed.push({
            key: item.key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return result;
    });
  }

  /**
   * 批量获取缓存条目
   */
  async getMany(keys: string[], options?: {
    version?: string;
    validateDependencies?: boolean;
  }): Promise<{
    found: Array<{ key: string; value: any }>;
    missing: string[];
  }> {
    return this.mutex.runExclusive(async () => {
      const result = {
        found: [] as Array<{ key: string; value: any }>,
        missing: [] as string[]
      };

      for (const key of keys) {
        try {
          const value = await this.get(key, options);
          if (value !== undefined) {
            result.found.push({ key, value });
          } else {
            result.missing.push(key);
          }
        } catch (error) {
          result.missing.push(key);
        }
      }

      return result;
    });
  }

  /**
   * 批量删除缓存条目
   */
  async deleteMany(keys: string[]): Promise<{
    success: string[];
    failed: string[];
  }> {
    return this.mutex.runExclusive(async () => {
      const result = {
        success: [] as string[],
        failed: [] as string[]
      };

      for (const key of keys) {
        try {
          const success = await this.delete(key);
          if (success) {
            result.success.push(key);
          } else {
            result.failed.push(key);
          }
        } catch (error) {
          result.failed.push(key);
        }
      }

      return result;
    });
  }
}
