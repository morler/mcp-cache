import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import { CacheEntry } from './types.js';

export interface CacheValidationResult {
  isValid: boolean;
  reason?: string;
  shouldInvalidate: boolean;
}

/**
 * 缓存版本管理器，专门处理Claude Code高频修改场景下的版本冲突
 */
export class CacheVersionManager {
  
  /**
   * 验证缓存条目是否仍然有效
   */
  static async validateEntry(entry: CacheEntry, key: string): Promise<CacheValidationResult> {
    // 检查TTL过期
    if (this.isExpiredByTTL(entry)) {
      return {
        isValid: false,
        reason: 'TTL expired',
        shouldInvalidate: true
      };
    }

    // 验证内容哈希（如果存在）
    if (entry.hash) {
      const currentHash = this.generateContentHash(entry.value);
      if (currentHash !== entry.hash) {
        return {
          isValid: false,
          reason: 'Content hash mismatch',
          shouldInvalidate: true
        };
      }
    }

    // 检查依赖文件变化
    if (entry.dependencies && entry.dependencies.length > 0) {
      const dependencyResult = await this.validateDependencies(entry);
      if (!dependencyResult.isValid) {
        return dependencyResult;
      }
    }

    return {
      isValid: true,
      shouldInvalidate: false
    };
  }

  /**
   * 检查TTL是否过期
   */
  private static isExpiredByTTL(entry: CacheEntry): boolean {
    if (!entry.ttl) return false;
    return Date.now() > entry.created + (entry.ttl * 1000);
  }

  /**
   * 生成内容哈希
   */
  private static generateContentHash(value: any): string {
    const content = JSON.stringify(value);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * 验证依赖文件
   */
  private static async validateDependencies(entry: CacheEntry): Promise<CacheValidationResult> {
    if (!entry.dependencies) {
      return { isValid: true, shouldInvalidate: false };
    }

    for (const depPath of entry.dependencies) {
      try {
        const stats = await fs.stat(depPath);
        
        // 检查文件修改时间
        if (stats.mtime.getTime() > entry.lastAccessed) {
          return {
            isValid: false,
            reason: `Dependency file modified: ${depPath}`,
            shouldInvalidate: true
          };
        }
        
      } catch (error) {
        // 文件不存在或无法访问
        return {
          isValid: false,
          reason: `Dependency file not accessible: ${depPath}`,
          shouldInvalidate: true
        };
      }
    }

    return { isValid: true, shouldInvalidate: false };
  }

  /**
   * 检测版本冲突
   */
  static detectVersionConflicts(
    cacheEntries: Map<string, CacheEntry>
  ): Array<{ keys: string[]; reason: string }> {
    const conflicts: Array<{ keys: string[]; reason: string }> = [];
    const versionGroups = new Map<string, string[]>();

    // 按基础键名分组
    for (const key of cacheEntries.keys()) {
      const baseKey = key.includes('@') ? key.split('@')[0] : key;
      if (!versionGroups.has(baseKey)) {
        versionGroups.set(baseKey, []);
      }
      versionGroups.get(baseKey)!.push(key);
    }

    // 检查每组是否有冲突
    for (const [baseKey, keys] of versionGroups) {
      if (keys.length > 1) {
        const entries = keys.map(key => ({
          key,
          entry: cacheEntries.get(key)!
        }));

        const timeDiffs = entries.map(e => e.entry.created);
        const maxTime = Math.max(...timeDiffs);
        const minTime = Math.min(...timeDiffs);

        // 如果最新和最旧的条目创建时间差超过1小时，可能存在版本冲突
        if (maxTime - minTime > 60 * 60 * 1000) {
          conflicts.push({
            keys: keys,
            reason: `Multiple versions with significant time gap for base key: ${baseKey}`
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 创建版本感知的缓存键
   */
  static createVersionedKey(baseKey: string, version?: string): string {
    if (!version) {
      version = this.getCurrentTimestamp();
    }
    return `${baseKey}@${version}`;
  }

  /**
   * 获取当前时间戳作为版本标识
   */
  private static getCurrentTimestamp(): string {
    return Date.now().toString();
  }

  /**
   * 从版本化键中提取基础键名
   */
  static extractBaseKey(versionedKey: string): string {
    return versionedKey.includes('@') ? versionedKey.split('@')[0] : versionedKey;
  }

  /**
   * 从版本化键中提取版本信息
   */
  static extractVersion(versionedKey: string): string | undefined {
    const parts = versionedKey.split('@');
    return parts.length > 1 ? parts[1] : undefined;
  }

  /**
   * 为缓存条目添加版本信息
   */
  static enhanceEntryWithVersion(
    entry: CacheEntry, 
    options: {
      version?: string;
      dependencies?: string[];
      sourceFile?: string;
    } = {}
  ): CacheEntry {
    const enhanced = { ...entry };
    
    if (options.version) {
      enhanced.version = options.version;
    }
    
    if (options.dependencies) {
      enhanced.dependencies = [...options.dependencies];
    }
    
    // 生成内容哈希用于后续验证
    enhanced.hash = this.generateContentHash(entry.value);
    
    return enhanced;
  }

  /**
   * 清理指定基础键的旧版本，保留最新的N个版本
   */
  static getKeysToCleanup(
    cacheEntries: Map<string, CacheEntry>,
    baseKey: string,
    keepVersions: number = 2
  ): string[] {
    const keysToDelete: string[] = [];
    const matchingKeys: Array<{ key: string; created: number }> = [];
    
    // 收集匹配的键和创建时间
    for (const [key, entry] of cacheEntries.entries()) {
      if (this.extractBaseKey(key) === baseKey) {
        matchingKeys.push({ key, created: entry.created });
      }
    }
    
    // 按创建时间排序，新的在前
    matchingKeys.sort((a, b) => b.created - a.created);
    
    // 标记需要删除的旧版本
    if (matchingKeys.length > keepVersions) {
      keysToDelete.push(...matchingKeys.slice(keepVersions).map(item => item.key));
    }
    
    return keysToDelete;
  }

  /**
   * 生成缓存诊断报告
   */
  static generateDiagnosticReport(cacheEntries: Map<string, CacheEntry>): {
    totalEntries: number;
    versionedEntries: number;
    conflicts: Array<{ keys: string[]; reason: string }>;
    expiredEntries: string[];
    largestEntries: Array<{ key: string; size: number }>;
  } {
    const conflicts = this.detectVersionConflicts(cacheEntries);
    const expiredEntries: string[] = [];
    const largestEntries: Array<{ key: string; size: number }> = [];
    
    let versionedEntries = 0;
    
    for (const [key, entry] of cacheEntries.entries()) {
      // 统计版本化条目
      if (key.includes('@')) {
        versionedEntries++;
      }
      
      // 检查过期条目
      if (this.isExpiredByTTL(entry)) {
        expiredEntries.push(key);
      }
      
      // 收集大条目信息
      largestEntries.push({ key, size: entry.size });
    }
    
    // 按大小排序，取前10个
    largestEntries.sort((a, b) => b.size - a.size);
    largestEntries.splice(10);
    
    return {
      totalEntries: cacheEntries.size,
      versionedEntries,
      conflicts,
      expiredEntries,
      largestEntries
    };
  }
}