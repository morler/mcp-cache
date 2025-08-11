import { CacheManager } from '../src/CacheManager';

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager({
      maxEntries: 100,
      maxMemory: 10 * 1024 * 1024, // 10MB
      defaultTTL: 3600,
      checkInterval: 60000,
      statsInterval: 30000
    });
  });

  afterEach(async () => {
    await cacheManager.destroy();
  });

  describe('基础操作', () => {
    test('应该能够存储和检索数据', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      await cacheManager.set(key, value);
      const retrieved = await cacheManager.get(key);
      
      expect(retrieved).toEqual(value);
    });

    test('应该能够删除数据', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      await cacheManager.set(key, value);
      expect(await cacheManager.get(key)).toEqual(value);
      
      const success = await cacheManager.delete(key);
      expect(success).toBe(true);
      expect(await cacheManager.get(key)).toBeUndefined();
    });

    test('应该能够清空缓存', async () => {
      await cacheManager.set('key1', 'value1');
      await cacheManager.set('key2', 'value2');
      
      expect(cacheManager.getStats().totalEntries).toBe(2);
      
      await cacheManager.clear();
      
      expect(cacheManager.getStats().totalEntries).toBe(0);
      expect(await cacheManager.get('key1')).toBeUndefined();
      expect(await cacheManager.get('key2')).toBeUndefined();
    });

    test('不存在的键应该返回undefined', async () => {
      const result = await cacheManager.get('non-existent-key');
      expect(result).toBeUndefined();
    });
  });

  describe('TTL功能', () => {
    test('应该支持TTL过期', async () => {
      const key = 'test-key';
      const value = 'test-value';
      const ttl = 0.1; // 100ms
      
      await cacheManager.set(key, value, ttl);
      expect(await cacheManager.get(key)).toBe(value);
      
      // 等待过期
      return new Promise(async resolve => {
        setTimeout(async () => {
          expect(await cacheManager.get(key)).toBeUndefined();
          resolve(true);
        }, 150);
      });
    });

    test('应该使用默认TTL', async () => {
      const key = 'test-key';
      const value = 'test-value';
      
      await cacheManager.set(key, value);
      const stats = cacheManager.getStats();
      
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe('统计功能', () => {
    test('应该正确统计命中率', async () => {
      await cacheManager.set('key1', 'value1');
      await cacheManager.set('key2', 'value2');
      
      // 命中
      await cacheManager.get('key1');
      await cacheManager.get('key2');
      
      // 未命中
      await cacheManager.get('non-existent1');
      await cacheManager.get('non-existent2');
      
      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(50);
    });

    test('应该统计内存使用', async () => {
      const largeValue = 'x'.repeat(1000);
      await cacheManager.set('large-key', largeValue);
      
      const stats = cacheManager.getStats();
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe('边界情况', () => {
    test('应该处理空键和值', async () => {
      await expect(cacheManager.set('', 'value')).rejects.toThrow();
      await expect(cacheManager.set('key', undefined as any)).rejects.toThrow();
    });

    test('应该处理负数TTL', async () => {
      await expect(cacheManager.set('key', 'value', -1)).rejects.toThrow();
    });

    test('应该处理过大的TTL', async () => {
      const largeTTL = 86400 * 366; // 超过1年
      await expect(cacheManager.set('key', 'value', largeTTL)).rejects.toThrow();
    });
  });
});