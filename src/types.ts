export interface CacheEntry {
  value: any;
  created: number;
  lastAccessed: number;
  ttl?: number;
  size: number;
  version?: string;  // 代码版本标识
  hash?: string;     // 内容哈希用于验证
  dependencies?: string[]; // 依赖的文件或模块列表
}

export interface CacheStats {
  totalEntries: number;
  memoryUsage: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgAccessTime: number;
}

export interface CacheConfig {
  maxEntries?: number;
  maxMemory?: number;
  defaultTTL?: number;
  checkInterval?: number;
  statsInterval?: number;
  preciseMemoryCalculation?: boolean;
  versionAwareMode?: boolean;
}
