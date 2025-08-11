import { CacheManager } from '../src/CacheManager';

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager({
      maxEntries: 100,
      maxMemory: 10 * 1024 * 1024,
      defaultTTL: 3600,
      checkInterval: 60000,
      statsInterval: 30000
    });
  });

  afterEach(async () => {
    await cacheManager.destroy();
  });

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
});