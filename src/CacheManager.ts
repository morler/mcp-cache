import { CacheEntry, CacheStats, CacheConfig, GetOptions } from './types.js';
import { calculateMemoryUsageAdaptive } from './memoryUtils.js';
import { AsyncMutex } from './AsyncMutex.js';
import { CacheError, CacheErrorCode, ErrorHandler } from './errorHandler.js';
import { DataEncryptor, AccessController, EncryptedData } from './encryption.js';
import { logger } from './logger.js';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';

// 内部配置类型，安全配置保持可选
type InternalCacheConfig = Required<Omit<CacheConfig, 'encryptionKey' | 'accessControl'>> & {
  encryptionKey?: string;
  accessControl?: {
    allowedOperations?: string[];
    restrictedKeys?: string[];
    restrictedPatterns?: string[];
  };
};

export class CacheManager {
  private cache: Map<string, CacheEntry>;
  private accessOrder: Map<string, { prev?: string; next?: string }>;
  private lruHead?: string;
  private lruTail?: string;
  private stats: CacheStats;
  private config: InternalCacheConfig;
  private cleanupInterval: ReturnType<typeof setInterval>;
  private statsUpdateInterval: ReturnType<typeof setInterval>;
  private mutex: AsyncMutex;
  
  // 性能优化相关
  private memoryUpdateBatchSize: number = 100;
  private lastMemoryCheck: number = 0;
  private memoryCheckInterval: number = 1000; // 1秒
  
  // 内存压力检测和智能垃圾回收
  private memoryPressureLevels = {
    LOW: 0.5,      // 50% - 低压力
    MEDIUM: 0.7,   // 70% - 中等压力
    HIGH: 0.85,    // 85% - 高压力
    CRITICAL: 0.95 // 95% - 临界压力
  };
  private currentPressureLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
  private lastGCTime: number = Date.now();
  private gcStats = {
    totalGCRuns: 0,
    totalBytesFreed: 0,
    avgGCTime: 0,
    lastGCDuration: 0,
    smartEvictions: 0,
    aggressiveEvictions: 0
  };
  private memoryCheckCounter: number = 0;
  private lastFullGC: number = Date.now();
  private fullGCInterval: number = 600000; // 10分钟强制GC
  
  // 版本管理相关
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();
  private versionAwareMode: boolean = false;
  
  // 安全相关
  private dataEncryptor?: DataEncryptor;
  private accessController?: AccessController;
  private encryptionEnabled: boolean = false;
  private sensitivePatterns: string[] = [];

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
      versionAwareMode: config.versionAwareMode ?? false,
      encryptionEnabled: config.encryptionEnabled ?? false,
      encryptionKey: config.encryptionKey ?? undefined,
      sensitivePatterns: config.sensitivePatterns ?? [],
      accessControl: config.accessControl ?? undefined
    };
    
    // 启用版本感知模式
    this.versionAwareMode = this.config.versionAwareMode;
    
    // 初始化安全功能
    this.encryptionEnabled = this.config.encryptionEnabled || false;
    this.sensitivePatterns = this.config.sensitivePatterns || [];
    
    if (this.encryptionEnabled) {
      this.dataEncryptor = new DataEncryptor(this.config.encryptionKey);
    }
    
    if (this.config.accessControl) {
      this.accessController = new AccessController(this.config.accessControl);
    }

    // Start maintenance intervals
    this.cleanupInterval = setInterval(() => {
      this.evictStale().catch(err => logger.error('Error cleaning expired entries:', err));
      this.performIntelligentGC(); // 智能垃圾回收
    }, this.config.checkInterval);
    this.statsUpdateInterval = setInterval(() => {
      this.updateStats();
      this.updateMemoryPressure();
    }, this.config.statsInterval);
  }

  async set(key: string, value: any, ttl?: number, options?: {
    version?: string;
    dependencies?: string[];
    sourceFile?: string;
  }): Promise<void> {
    return this.mutex.runExclusive(async () => {
      try {
        // 访问控制检查
        if (this.accessController) {
          this.accessController.validateAccess('set', key);
        }
        
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
        
            // 版本感知模式处理（优化版本）
        let finalKey = key;
        let finalValue = value;
        
        if (this.versionAwareMode && options) {
          const { version, dependencies = [], sourceFile } = options;
          
          // 使用更高效的哈希生成
          const contentHash = this.generateHashOptimized(value);
          
          // 使用时间戳作为版本标识
          const timestamp = version || Date.now().toString();
          
          // 创建带版本信息的键
          finalKey = this.createVersionedKey(key, timestamp);
          
          // 异步设置依赖监控，避免阻塞主流程
          if (sourceFile && dependencies.length > 0) {
            this.setupDependencyWatchingAsync(finalKey, sourceFile, dependencies);
          }
          
          // 异步清理旧版本，避免阻塞
          this.cleanupOldVersionsAsync(key, timestamp);
        }
        
        // 检查是否需要加密
        let shouldEncrypt = false;
        let encryptedValue = finalValue;
        
        if (this.encryptionEnabled && this.dataEncryptor) {
          shouldEncrypt = DataEncryptor.shouldEncrypt(key, finalValue, this.sensitivePatterns);
          if (shouldEncrypt) {
            encryptedValue = this.dataEncryptor.encrypt(finalValue);
          }
        }
        
        // 优化内存计算，批量处理时跳过精确计算
        const size = this.shouldSkipPreciseMemoryCalculation() 
          ? this.approximateMemoryUsage(finalKey, encryptedValue)
          : calculateMemoryUsageAdaptive(finalKey, encryptedValue, {
              precise: this.config.preciseMemoryCalculation
            }).totalSize;
        
        const entry: CacheEntry = {
          value: encryptedValue,
          created: Date.now(),
          lastAccessed: Date.now(),
          ttl: ttl ?? this.config.defaultTTL,
          size,
          encrypted: shouldEncrypt
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

        // 优化限制检查逻辑
        const effectiveMemoryIncrease = isUpdate ? size - (this.cache.get(finalKey)?.size || 0) : size;
        
        if (this.needsEviction(effectiveMemoryIncrease, isUpdate)) {
          try {
            await this.enforceMemoryLimitOptimized(effectiveMemoryIncrease);
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
      // 访问控制检查
      if (this.accessController) {
        this.accessController.validateAccess('get', key);
      }
      
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

      // 更新热点键统计
      this.updateHotKeyStats(key);

      const endTime = performance.now();
      this.updateAccessTime(endTime - startTime);

      // 如果数据已加密，需要解密
      let finalValue = entry.value;
      if (entry.encrypted && this.dataEncryptor) {
        try {
          finalValue = this.dataEncryptor.decrypt(entry.value);
        } catch (error) {
          throw CacheError.createError(
            CacheErrorCode.UNKNOWN_ERROR,
            `解密失败: ${error instanceof Error ? error.message : String(error)}`,
            { key, operation: 'get' }
          );
        }
      }

      return finalValue;
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      // 访问控制检查
      if (this.accessController) {
        this.accessController.validateAccess('delete', key);
      }
      
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
      // 访问控制检查
      if (this.accessController) {
        this.accessController.validateAccess('clear');
      }
      
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
    await this.enforceMemoryLimitOptimized(requiredSize);
  }

  // 优化版本的内存限制执行
  private async enforceMemoryLimitOptimized(requiredSize: number): Promise<void> {
    const batchSize = 10; // 批量删除大小
    const keysToDelete: string[] = [];
    
    let current = this.lruTail;
    
    // 收集需要删除的键
    while (current && 
           (this.stats.memoryUsage + requiredSize > this.config.maxMemory || 
            this.cache.size >= this.config.maxEntries) &&
           keysToDelete.length < batchSize * 3) { // 最多删除30个
      
      keysToDelete.push(current);
      const node = this.accessOrder.get(current);
      current = node?.prev;
      
      // 估算删除后的内存
      const entry = this.cache.get(current!);
      if (entry && this.stats.memoryUsage - entry.size + requiredSize <= this.config.maxMemory && 
          this.cache.size - keysToDelete.length < this.config.maxEntries) {
        break;
      }
    }
    
    // 批量删除
    for (const key of keysToDelete) {
      this.deleteInternal(key);
    }
    
    // 如果仍然超限，抛出错误
    if (this.stats.memoryUsage + requiredSize > this.config.maxMemory) {
      throw CacheError.createError(
        CacheErrorCode.MEMORY_LIMIT_EXCEEDED,
        'Cannot free enough memory even after eviction',
        { 
          currentMemory: this.stats.memoryUsage,
          maxMemory: this.config.maxMemory,
          requiredSize,
          evictedKeys: keysToDelete.length
        }
      );
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
    this.updateHitRate();
    
    // 定期更新内存使用统计
    const now = Date.now();
    if (now - this.lastMemoryCheck > this.memoryCheckInterval) {
      this.recalculateMemoryUsage();
      this.lastMemoryCheck = now;
    }
  }
  
  // 性能优化辅助方法
  private shouldSkipPreciseMemoryCalculation(): boolean {
    // 在批量操作时跳过精确计算
    return this.memoryUpdateBatchSize > 50;
  }
  
  private approximateMemoryUsage(key: string, value: any): number {
    // 快速内存估算，用于批量操作
    const keySize = key.length * 2; // UTF-16
    const valueSize = typeof value === 'string' 
      ? value.length * 2
      : JSON.stringify(value).length * 2;
    return keySize + valueSize + 100; // 加上对象开销
  }
  
  private needsEviction(memoryIncrease: number, isUpdate: boolean): boolean {
    const wouldExceedMemory = this.stats.memoryUsage + memoryIncrease > this.config.maxMemory;
    const wouldExceedEntries = !isUpdate && this.cache.size >= this.config.maxEntries;
    return wouldExceedMemory || wouldExceedEntries;
  }
  
  private recalculateMemoryUsage(): number {
    // 定期重新计算内存使用量，防止累积误差
    let totalMemory = 0;
    for (const entry of this.cache.values()) {
      totalMemory += entry.size;
    }
    
    const memoryDifference = Math.abs(totalMemory - this.stats.memoryUsage);
    if (memoryDifference > 1024 * 1024) { // 差异超过1MB时才更新
      logger.warn(`Memory usage statistics deviation detected, recalibrating: ${this.stats.memoryUsage} -> ${totalMemory}`);
      this.stats.memoryUsage = totalMemory;
      return memoryDifference; // 返回校准节省的内存差异
    }
    return 0;
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
        logger.warn(`Error closing file watcher ${filePath}:`, error);
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
   * 优化版本的哈希生成 - 对大对象使用更高效的方法
   */
  private generateHashOptimized(value: any): string {
    let content: string;
    
    // 对于大对象，使用更高效的序列化方法
    if (typeof value === 'object' && value !== null) {
      const size = JSON.stringify(value).length;
      if (size > 10000) { // 大于10KB的对象
        // 使用对象键和值的摘要而不是完整序列化
        const keys = Object.keys(value).slice(0, 100); // 最多100个键
        const summary = {
          keys: keys,
          size: size,
          type: Array.isArray(value) ? 'array' : 'object',
          firstValues: keys.slice(0, 10).map(k => value[k])
        };
        content = JSON.stringify(summary);
      } else {
        content = JSON.stringify(value);
      }
    } else {
      content = String(value);
    }
    
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
   * 异步设置依赖文件监控
   */
  private setupDependencyWatchingAsync(
    cacheKey: string, 
    sourceFile: string, 
    dependencies: string[]
  ): void {
    // 异步执行，不阻塞主流程
    this.setupDependencyWatching(cacheKey, sourceFile, dependencies)
      .catch(error => logger.warn('Failed to setup dependency monitoring:', error));
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
              // File change detected, clearing related cache
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
        logger.warn(`Cannot monitor file ${filePath}:`, error);
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
   * 异步清理指定键的旧版本
   */
  private cleanupOldVersionsAsync(baseKey: string, currentVersion: string): void {
    // 异步执行，不阻塞主流程
    this.cleanupOldVersions(baseKey, currentVersion)
      .catch(error => logger.warn('Failed to cleanup old versions:', error));
  }
  
  /**
   * 清理指定键的旧版本
   */
  private async cleanupOldVersions(baseKey: string, currentVersion: string): Promise<void> {
    const keysToDelete: string[] = [];
    const versionPattern = `${baseKey}@`;
    
    // 优化：使用forEach而不是for...of，减少迭代器开销
    this.cache.forEach((_, key) => {
      if (key.startsWith(versionPattern) && !key.endsWith(`@${currentVersion}`)) {
        keysToDelete.push(key);
      }
    });
    
    // 删除旧版本（保留最近的2个版本）- 优化排序
    if (keysToDelete.length > 2) {
      keysToDelete.sort().slice(0, -2).forEach(key => {
        this.deleteInternal(key);
      });
    }
  }
  
  /**
   * 当依赖文件变化时，使相关缓存失效
   */
  private invalidateDependentCaches(filePath: string): void {
    const dependentCaches = this.dependencyGraph.get(filePath);
    if (dependentCaches) {
      // Clearing ${dependentCaches.size} caches dependent on ${filePath}
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
            // File change detected: ${filePath}
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
      logger.warn(`Failed to setup file watcher ${filePath}:`, error);
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
      // Stopped file watching: ${filePath}
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
   * 批量设置缓存条目 - 优化版本
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
      
      // 批量操作标记，优化内存计算
      const originalBatchSize = this.memoryUpdateBatchSize;
      this.memoryUpdateBatchSize = items.length;

      // 预先计算总内存需求
      let totalMemoryNeeded = 0;
      const processedItems: Array<{
        finalKey: string;
        entry: CacheEntry;
        originalItem: typeof items[0];
      }> = [];
      
      // 预处理阶段 - 计算内存并准备条目
      for (const item of items) {
        try {
          // 访问控制检查
          if (this.accessController) {
            this.accessController.validateAccess('set', item.key);
          }
          
          let finalKey = item.key;
          let finalValue = item.value;
          
          // 版本处理
          if (this.versionAwareMode && item.options) {
            const timestamp = item.options.version || Date.now().toString();
            finalKey = this.createVersionedKey(item.key, timestamp);
          }
          
          // 加密处理
          let encryptedValue = finalValue;
          let shouldEncrypt = false;
          if (this.encryptionEnabled && this.dataEncryptor) {
            shouldEncrypt = DataEncryptor.shouldEncrypt(item.key, finalValue, this.sensitivePatterns);
            if (shouldEncrypt) {
              encryptedValue = this.dataEncryptor.encrypt(finalValue);
            }
          }
          
          // 快速内存估算
          const size = this.approximateMemoryUsage(finalKey, encryptedValue);
          totalMemoryNeeded += size;
          
          const entry: CacheEntry = {
            value: encryptedValue,
            created: Date.now(),
            lastAccessed: Date.now(),
            ttl: item.ttl ?? this.config.defaultTTL,
            size,
            encrypted: shouldEncrypt
          };
          
          processedItems.push({ finalKey, entry, originalItem: item });
        } catch (error) {
          result.failed.push({
            key: item.key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      // 检查内存限制
      if (this.stats.memoryUsage + totalMemoryNeeded > this.config.maxMemory) {
        try {
          await this.enforceMemoryLimitOptimized(totalMemoryNeeded);
        } catch (error) {
          // 如果无法释放足够内存，至少处理能够容纳的项目
          const availableMemory = this.config.maxMemory - this.stats.memoryUsage;
          let usedMemory = 0;
          
          for (let i = processedItems.length - 1; i >= 0; i--) {
            if (usedMemory + processedItems[i].entry.size > availableMemory) {
              const removedItem = processedItems.splice(i, 1)[0];
              result.failed.push({
                key: removedItem.originalItem.key,
                error: 'Insufficient memory for batch operation'
              });
            } else {
              usedMemory += processedItems[i].entry.size;
            }
          }
        }
      }
      
      // 执行批量插入
      for (const { finalKey, entry, originalItem } of processedItems) {
        try {
          const isUpdate = this.cache.has(finalKey);
          if (isUpdate) {
            const oldEntry = this.cache.get(finalKey)!;
            this.stats.memoryUsage -= oldEntry.size;
          } else {
            this.addToLRUChain(finalKey);
          }
          
          this.cache.set(finalKey, entry);
          this.moveToHead(finalKey);
          this.stats.memoryUsage += entry.size;
          
          result.success.push(originalItem.key);
        } catch (error) {
          result.failed.push({
            key: originalItem.key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      // 更新统计
      this.stats.totalEntries = this.cache.size;
      
      // 恢复原始批量大小
      this.memoryUpdateBatchSize = originalBatchSize;

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

  // 缓存预热相关功能
  private hotKeys: Map<string, { accessCount: number; lastAccessed: number }> = new Map();
  private preheatingStats = {
    preheatedKeys: 0,
    preheatingHits: 0,
    lastPreheatingTime: 0
  };
  
  // 防缓存击穿相关
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private nullValueCache: Map<string, number> = new Map(); // 缓存空值，值为过期时间
  private nullValueTTL: number = 300; // 空值缓存TTL，默认5分钟

  /**
   * 获取热点键列表
   */
  getHotKeys(limit: number = 10, minAccess: number = 5): string[] {
    const now = Date.now();
    const hotKeysList = Array.from(this.hotKeys.entries())
      .filter(([_, stats]) => {
        // 只考虑最近1小时内访问的键，且访问次数超过阈值
        const isRecent = now - stats.lastAccessed < 3600000; // 1小时
        const isFrequent = stats.accessCount >= minAccess;
        return isRecent && isFrequent;
      })
      .sort((a, b) => b[1].accessCount - a[1].accessCount)
      .slice(0, limit)
      .map(([key]) => key);

    return hotKeysList;
  }

  /**
   * 预热指定的键
   */
  async preheatKeys(keys: string[], preheatingData?: Map<string, any>): Promise<{
    success: string[];
    failed: string[];
    alreadyCached: string[];
  }> {
    const result = {
      success: [] as string[],
      failed: [] as string[],
      alreadyCached: [] as string[]
    };

    for (const key of keys) {
      try {
        // 检查是否已经在缓存中
        if (this.cache.has(key)) {
          result.alreadyCached.push(key);
          continue;
        }

        // 如果提供了预热数据，直接使用
        if (preheatingData?.has(key)) {
          await this.set(key, preheatingData.get(key));
          result.success.push(key);
          this.preheatingStats.preheatedKeys++;
        } else {
          // 否则标记为失败（需要外部提供数据）
          result.failed.push(key);
        }
      } catch (error) {
        result.failed.push(key);
      }
    }

    this.preheatingStats.lastPreheatingTime = Date.now();
    return result;
  }

  /**
   * 自动预热热点数据
   */
  async autoPreheating(dataProvider?: (keys: string[]) => Promise<Map<string, any>>): Promise<{
    preheated: number;
    skipped: number;
    failed: number;
  }> {
    const hotKeys = this.getHotKeys();
    if (hotKeys.length === 0) {
      return { preheated: 0, skipped: 0, failed: 0 };
    }

    let preheatingData: Map<string, any> | undefined;
    if (dataProvider) {
      try {
        preheatingData = await dataProvider(hotKeys);
      } catch (error) {
        logger.warn('Preheating data provider error:', error);
        return { preheated: 0, skipped: 0, failed: hotKeys.length };
      }
    }

    const result = await this.preheatKeys(hotKeys, preheatingData);
    return {
      preheated: result.success.length,
      skipped: result.alreadyCached.length,
      failed: result.failed.length
    };
  }

  /**
   * 更新热点键统计
   */
  private updateHotKeyStats(key: string): void {
    const now = Date.now();
    const stats = this.hotKeys.get(key) || { accessCount: 0, lastAccessed: now };
    stats.accessCount++;
    stats.lastAccessed = now;
    this.hotKeys.set(key, stats);

    // 清理过期的热点键统计（超过24小时未访问）
    if (this.hotKeys.size > 1000) { // 控制热点键统计的内存使用
      const cutoffTime = now - 24 * 3600000; // 24小时前
      for (const [hotKey, hotStats] of this.hotKeys.entries()) {
        if (hotStats.lastAccessed < cutoffTime) {
          this.hotKeys.delete(hotKey);
        }
      }
    }
  }

  /**
   * 获取预热统计信息
   */
  getPreheatingStats(): {
    preheatedKeys: number;
    preheatingHits: number;
    lastPreheatingTime: number;
    hotKeysCount: number;
    topHotKeys: Array<{ key: string; accessCount: number; lastAccessed: number }>;
  } {
    const topHotKeys = Array.from(this.hotKeys.entries())
      .sort((a, b) => b[1].accessCount - a[1].accessCount)
      .slice(0, 5)
      .map(([key, stats]) => ({ key, ...stats }));

    return {
      ...this.preheatingStats,
      hotKeysCount: this.hotKeys.size,
      topHotKeys
    };
  }

  // 安全管理方法
  /**
   * 获取加密统计信息
   */
  getSecurityStats(): {
    encryptionEnabled: boolean;
    encryptedEntries: number;
    accessControlEnabled: boolean;
    hasEncryptionKey: boolean;
  } {
    let encryptedCount = 0;
    
    for (const entry of this.cache.values()) {
      if (entry.encrypted) {
        encryptedCount++;
      }
    }

    return {
      encryptionEnabled: this.encryptionEnabled,
      encryptedEntries: encryptedCount,
      accessControlEnabled: !!this.accessController,
      hasEncryptionKey: !!this.dataEncryptor
    };
  }

  /**
   * 更新敏感数据模式
   */
  updateSensitivePatterns(patterns: string[]): void {
    this.sensitivePatterns = patterns;
  }

  /**
   * 添加受限制的键
   */
  addRestrictedKey(key: string): void {
    if (this.accessController) {
      this.accessController.addRestrictedKey(key);
    }
  }

  /**
   * 移除受限制的键
   */
  removeRestrictedKey(key: string): void {
    if (this.accessController) {
      this.accessController.removeRestrictedKey(key);
    }
  }

  /**
   * 获取加密密钥（仅在启用加密时）
   */
  getEncryptionKey(): string | undefined {
    if (this.dataEncryptor) {
      return this.dataEncryptor.getKeyHex();
    }
    return undefined;
  }

  /**
   * 生成新的加密密钥
   */
  static generateEncryptionKey(): string {
    return DataEncryptor.generateKey();
  }

  // 防缓存击穿功能
  /**
   * 带缓存击穿保护的数据获取
   * @param key 缓存键
   * @param dataLoader 数据加载器函数，当缓存未命中时调用
   * @param options 获取选项
   * @returns Promise<T | undefined>
   */
  async getWithProtection<T>(
    key: string, 
    dataLoader: () => Promise<T | null>, 
    options?: GetOptions
  ): Promise<T | undefined> {
    // 首先尝试从缓存获取
    const cachedValue = await this.get(key, options);
    if (cachedValue !== undefined) {
      // 如果是预热命中，更新统计
      if (this.hotKeys.has(key)) {
        this.preheatingStats.preheatingHits++;
      }
      return cachedValue;
    }

    // 检查空值缓存
    const nullExpire = this.nullValueCache.get(key);
    if (nullExpire && Date.now() < nullExpire) {
      return undefined; // 空值缓存未过期，直接返回空
    }

    // 检查是否有正在进行的请求
    const pendingRequest = this.pendingRequests.get(key);
    if (pendingRequest) {
      try {
        return await pendingRequest;
      } catch (error) {
        // 如果等待的请求失败，移除待处理请求并重新尝试
        this.pendingRequests.delete(key);
        throw error;
      }
    }

    // 创建新的数据加载请求
    const dataLoadPromise = this.loadDataWithMutex(key, dataLoader);
    this.pendingRequests.set(key, dataLoadPromise);

    try {
      const result = await dataLoadPromise;
      this.pendingRequests.delete(key);
      return result;
    } catch (error) {
      this.pendingRequests.delete(key);
      throw error;
    }
  }

  /**
   * 使用互斥锁保护的数据加载 - 优化版本
   */
  private async loadDataWithMutex<T>(
    key: string, 
    dataLoader: () => Promise<T | null>
  ): Promise<T | undefined> {
    // 使用更轻量级的锁机制
    return this.mutex.runExclusive(async () => {
      // 双重检查：可能在等待锁的过程中其他线程已经加载了数据
      const existingValue = this.cache.get(key);
      if (existingValue && !this.isExpired(existingValue)) {
        // 直接从缓存获取，跳过get方法的额外检查
        existingValue.lastAccessed = Date.now();
        this.moveToHead(key);
        this.stats.hits++;
        this.updateHitRate();
        
        // 处理解密
        let finalValue = existingValue.value;
        if (existingValue.encrypted && this.dataEncryptor) {
          finalValue = this.dataEncryptor.decrypt(existingValue.value);
        }
        
        return finalValue;
      }

      try {
        const loadedData = await dataLoader();
        
        if (loadedData === null || loadedData === undefined) {
          // 缓存空值，避免缓存击穿
          this.cacheNullValue(key);
          return undefined;
        }

        // 直接构造缓存条目，避免调用set方法的开销
        const size = this.approximateMemoryUsage(key, loadedData);
        const entry: CacheEntry = {
          value: loadedData,
          created: Date.now(),
          lastAccessed: Date.now(),
          ttl: this.config.defaultTTL,
          size,
          encrypted: false
        };
        
        // 检查内存限制
        if (this.needsEviction(size, false)) {
          await this.enforceMemoryLimitOptimized(size);
        }
        
        // 添加到缓存
        this.addToLRUChain(key);
        this.cache.set(key, entry);
        this.moveToHead(key);
        this.stats.totalEntries = this.cache.size;
        this.stats.memoryUsage += size;
        
        return loadedData;
      } catch (error) {
        // 加载失败时也缓存空值，但TTL较短
        this.cacheNullValue(key, 60); // 1分钟
        throw error;
      }
    });
  }

  /**
   * 缓存空值以防止缓存击穿
   */
  private cacheNullValue(key: string, ttlSeconds: number = this.nullValueTTL): void {
    const expireTime = Date.now() + ttlSeconds * 1000;
    this.nullValueCache.set(key, expireTime);
    
    // 清理过期的空值缓存
    this.cleanupNullValueCache();
  }

  /**
   * 清理过期的空值缓存
   */
  private cleanupNullValueCache(): void {
    const now = Date.now();
    for (const [key, expireTime] of this.nullValueCache.entries()) {
      if (now >= expireTime) {
        this.nullValueCache.delete(key);
      }
    }
  }

  /**
   * 手动清除指定键的空值缓存
   */
  clearNullValueCache(key?: string): void {
    if (key) {
      this.nullValueCache.delete(key);
    } else {
      this.nullValueCache.clear();
    }
  }

  /**
   * 获取缓存击穿保护统计信息
   */
  getCachePenetrationStats(): {
    pendingRequests: number;
    nullValueCacheSize: number;
    nullValueTTL: number;
  } {
    return {
      pendingRequests: this.pendingRequests.size,
      nullValueCacheSize: this.nullValueCache.size,
      nullValueTTL: this.nullValueTTL
    };
  }

  // ==== 智能内存管理和垃圾回收功能 ====
  
  /**
   * 更新内存压力等级
   */
  private updateMemoryPressure(): void {
    const memoryUsageRatio = this.stats.memoryUsage / this.config.maxMemory;
    const previousLevel = this.currentPressureLevel;
    
    if (memoryUsageRatio >= this.memoryPressureLevels.CRITICAL) {
      this.currentPressureLevel = 'CRITICAL';
    } else if (memoryUsageRatio >= this.memoryPressureLevels.HIGH) {
      this.currentPressureLevel = 'HIGH';
    } else if (memoryUsageRatio >= this.memoryPressureLevels.MEDIUM) {
      this.currentPressureLevel = 'MEDIUM';
    } else {
      this.currentPressureLevel = 'LOW';
    }
    
    // 压力等级变化时记录日志
    if (previousLevel !== this.currentPressureLevel) {
      logger.info(`Memory pressure level changed: ${previousLevel} -> ${this.currentPressureLevel} (usage: ${(memoryUsageRatio * 100).toFixed(1)}%)`);
    }
  }
  
  /**
   * 执行智能垃圾回收
   */
  private performIntelligentGC(): void {
    const now = Date.now();
    this.memoryCheckCounter++;
    
    // 基于内存压力等级和时间间隔决定GC策略
    const shouldPerformGC = this.shouldPerformGC(now);
    
    if (shouldPerformGC) {
      const startTime = Date.now();
      const freedBytes = this.executeSmartGC();
      const duration = Date.now() - startTime;
      
      // 更新GC统计
      this.gcStats.totalGCRuns++;
      this.gcStats.totalBytesFreed += freedBytes;
      this.gcStats.lastGCDuration = duration;
      this.gcStats.avgGCTime = (this.gcStats.avgGCTime * (this.gcStats.totalGCRuns - 1) + duration) / this.gcStats.totalGCRuns;
      this.lastGCTime = now;
      
      if (freedBytes > 0) {
        logger.info(`Smart GC completed: freed ${this.formatBytes(freedBytes)}, took ${duration}ms, pressure level: ${this.currentPressureLevel}`);
      }
    }
    
    // 定期强制全面GC
    if (now - this.lastFullGC > this.fullGCInterval) {
      this.performFullGC();
      this.lastFullGC = now;
    }
  }
  
  /**
   * 判断是否应该执行GC
   */
  private shouldPerformGC(now: number): boolean {
    const timeSinceLastGC = now - this.lastGCTime;
    
    switch (this.currentPressureLevel) {
      case 'CRITICAL':
        return timeSinceLastGC > 5000; // 5秒
      case 'HIGH':
        return timeSinceLastGC > 15000; // 15秒
      case 'MEDIUM':
        return timeSinceLastGC > 30000; // 30秒
      case 'LOW':
        return timeSinceLastGC > 120000; // 2分钟
      default:
        return false;
    }
  }
  
  /**
   * 执行智能垃圾回收
   */
  private executeSmartGC(): number {
    let totalFreed = 0;
    const startTime = Date.now();
    
    // 第一阶段：清理过期条目
    totalFreed += this.cleanupExpiredEntries();
    
    // 第二阶段：基于访问频率和时间的智能淘汰
    if (this.currentPressureLevel === 'HIGH' || this.currentPressureLevel === 'CRITICAL') {
      totalFreed += this.performSmartEviction();
    }
    
    // 第三阶段：临界状态下的激进清理
    if (this.currentPressureLevel === 'CRITICAL') {
      totalFreed += this.performAggressiveEviction();
    }
    
    // 第四阶段：清理辅助数据结构
    totalFreed += this.cleanupAuxiliaryData();
    
    return totalFreed;
  }
  
  /**
   * 清理过期条目
   */
  private cleanupExpiredEntries(): number {
    let freedBytes = 0;
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        expiredKeys.push(key);
        freedBytes += entry.size;
      }
    }
    
    // 批量删除过期条目
    expiredKeys.forEach(key => this.deleteInternal(key));
    
    if (expiredKeys.length > 0) {
      logger.info(`Cleaned expired entries: ${expiredKeys.length}, freed ${this.formatBytes(freedBytes)}`);
    }
    
    return freedBytes;
  }
  
  /**
   * 智能淘汰策略：基于访问频率和最后访问时间
   */
  private performSmartEviction(): number {
    let freedBytes = 0;
    const now = Date.now();
    const targetFreed = this.stats.memoryUsage * 0.2; // 目标释放20%内存
    
    // 计算每个条目的淘汰权重（权重越低，越容易被淘汰）
    const entriesWithWeight = Array.from(this.cache.entries())
      .map(([key, entry]) => {
        const timeSinceAccess = now - entry.lastAccessed;
        const accessFrequency = this.hotKeys.get(key)?.accessCount || 1;
        
        // 权重计算：访问频率高、最近访问的权重高
        const timeWeight = Math.max(0, 1 - (timeSinceAccess / (24 * 3600000))); // 24小时内的时间权重
        const frequencyWeight = Math.min(1, Math.log(accessFrequency + 1) / 10); // 频率权重
        const sizeWeight = Math.max(0, 1 - (entry.size / (1024 * 1024))); // 大小权重，大文件权重低
        
        const totalWeight = (timeWeight * 0.4 + frequencyWeight * 0.4 + sizeWeight * 0.2);
        
        return { key, entry, weight: totalWeight };
      })
      .filter(({ entry }) => !this.isExpired(entry))
      .sort((a, b) => a.weight - b.weight); // 权重从低到高排序
    
    // 淘汰权重最低的条目
    for (const { key, entry } of entriesWithWeight) {
      if (freedBytes >= targetFreed) break;
      
      freedBytes += entry.size;
      this.deleteInternal(key);
      this.gcStats.smartEvictions++;
    }
    
    if (freedBytes > 0) {
      logger.info(`Smart eviction: freed ${this.formatBytes(freedBytes)}, entries evicted: ${this.gcStats.smartEvictions}`);
    }
    
    return freedBytes;
  }
  
  /**
   * 激进淘汰策略：临界状态下快速释放内存
   */
  private performAggressiveEviction(): number {
    let freedBytes = 0;
    const targetFreed = this.stats.memoryUsage * 0.4; // 目标释放40%内存
    
    // 找出最大的条目优先淘汰
    const entriesBySize = Array.from(this.cache.entries())
      .filter(([_, entry]) => !this.isExpired(entry))
      .sort((a, b) => b[1].size - a[1].size);
    
    for (const [key, entry] of entriesBySize) {
      if (freedBytes >= targetFreed) break;
      
      freedBytes += entry.size;
      this.deleteInternal(key);
      this.gcStats.aggressiveEvictions++;
    }
    
    if (freedBytes > 0) {
      logger.info(`Aggressive eviction: freed ${this.formatBytes(freedBytes)}, large files evicted: ${this.gcStats.aggressiveEvictions}`);
    }
    
    return freedBytes;
  }
  
  /**
   * 清理辅助数据结构
   */
  private cleanupAuxiliaryData(): number {
    let freedBytes = 0;
    const now = Date.now();
    
    // 清理热点键统计中过期的条目
    const hotKeysToDelete: string[] = [];
    for (const [key, stats] of this.hotKeys.entries()) {
      if (now - stats.lastAccessed > 24 * 3600000) { // 24小时未访问
        hotKeysToDelete.push(key);
      }
    }
    hotKeysToDelete.forEach(key => this.hotKeys.delete(key));
    
    // 清理空值缓存中过期的条目
    this.cleanupNullValueCache();
    
    // 估算清理的辅助数据大小
    freedBytes += hotKeysToDelete.length * 64; // 假设每个热点键统计占64字节
    
    return freedBytes;
  }
  
  /**
   * 执行全面垃圾回收
   */
  private performFullGC(): void {
    const startTime = Date.now();
    let freedBytes = 0;
    
    // Starting full garbage collection process
    
    // 1. 清理所有过期条目
    freedBytes += this.cleanupExpiredEntries();
    
    // 2. 清理所有辅助数据结构
    freedBytes += this.cleanupAuxiliaryData();
    
    // 3. 重新计算内存使用量
    freedBytes += this.recalculateMemoryUsage();
    
    // 4. 优化LRU链表结构
    this.optimizeLRUChain();
    
    const duration = Date.now() - startTime;
    logger.info(`Full GC completed: freed ${this.formatBytes(freedBytes)}, took ${duration}ms`);
  }
  
  /**
   * 优化LRU链表结构
   */
  private optimizeLRUChain(): void {
    // 重新构建LRU链表，移除断链等问题
    const validKeys = Array.from(this.cache.keys());
    this.accessOrder.clear();
    this.lruHead = undefined;
    this.lruTail = undefined;
    
    // 按最后访问时间重新排序并构建链表
    const sortedEntries = validKeys
      .map(key => ({ key, lastAccessed: this.cache.get(key)!.lastAccessed }))
      .sort((a, b) => b.lastAccessed - a.lastAccessed);
    
    for (const { key } of sortedEntries) {
      this.addToLRUChain(key);
    }
    
    logger.info(`LRU chain reconstruction completed, ${validKeys.length} nodes total`);
  }
  
  /**
   * 获取垃圾回收统计信息
   */
  getGCStats(): {
    currentPressureLevel: string;
    totalGCRuns: number;
    totalBytesFreed: string;
    avgGCTime: number;
    lastGCDuration: number;
    smartEvictions: number;
    aggressiveEvictions: number;
    timeSinceLastGC: number;
    timeSinceLastFullGC: number;
  } {
    const now = Date.now();
    return {
      currentPressureLevel: this.currentPressureLevel,
      totalGCRuns: this.gcStats.totalGCRuns,
      totalBytesFreed: this.formatBytes(this.gcStats.totalBytesFreed),
      avgGCTime: Math.round(this.gcStats.avgGCTime * 100) / 100,
      lastGCDuration: this.gcStats.lastGCDuration,
      smartEvictions: this.gcStats.smartEvictions,
      aggressiveEvictions: this.gcStats.aggressiveEvictions,
      timeSinceLastGC: now - this.lastGCTime,
      timeSinceLastFullGC: now - this.lastFullGC
    };
  }
  
  /**
   * 手动触发垃圾回收
   */
  async forceGC(aggressive: boolean = false): Promise<{
    freedBytes: string;
    duration: number;
    entriesRemoved: number;
  }> {
    const startTime = Date.now();
    const initialEntries = this.cache.size;
    
    let freedBytes: number;
    if (aggressive) {
      this.performFullGC();
      freedBytes = this.gcStats.totalBytesFreed;
    } else {
      freedBytes = this.executeSmartGC();
    }
    
    const duration = Date.now() - startTime;
    const entriesRemoved = initialEntries - this.cache.size;
    
    return {
      freedBytes: this.formatBytes(freedBytes),
      duration,
      entriesRemoved
    };
  }
  
  /**
   * 设置内存压力阈值
   */
  setMemoryPressureThresholds(thresholds: {
    low?: number;
    medium?: number;
    high?: number;
    critical?: number;
  }): void {
    if (thresholds.low !== undefined) this.memoryPressureLevels.LOW = thresholds.low;
    if (thresholds.medium !== undefined) this.memoryPressureLevels.MEDIUM = thresholds.medium;
    if (thresholds.high !== undefined) this.memoryPressureLevels.HIGH = thresholds.high;
    if (thresholds.critical !== undefined) this.memoryPressureLevels.CRITICAL = thresholds.critical;
    
    logger.info('Memory pressure thresholds updated:', this.memoryPressureLevels);
  }
  
  /**
   * 格式化字节数为可读格式
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
