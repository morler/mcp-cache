import { CacheManager } from '../src/CacheManager';
import { 
  validateStoreArgs,
  validateRetrieveArgs,
  validateClearArgs 
} from '../src/validators';
import { calculateMemoryUsageAdaptive } from '../src/memoryUtils';

describe('集成测试', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager({
      maxEntries: 100,
      maxMemory: 10 * 1024 * 1024, // 10MB
      defaultTTL: 3600,
      checkInterval: 60000,
      statsInterval: 30000,
      preciseMemoryCalculation: true
    });
  });

  afterEach(async () => {
    await cacheManager.destroy();
  });

  describe('完整的缓存工作流', () => {
    test('应该完成完整的存储-检索-删除流程', async () => {
      const testData = {
        user: {
          id: 123,
          name: 'John Doe',
          preferences: {
            theme: 'dark',
            language: 'zh-CN'
          },
          tags: ['premium', 'verified']
        },
        timestamp: Date.now(),
        metadata: {
          source: 'api',
          version: '1.0'
        }
      };

      // 1. 验证存储参数
      const storeValidation = validateStoreArgs({
        key: 'user:123',
        value: testData,
        ttl: 1800
      });
      expect(storeValidation.isValid).toBe(true);

      // 2. 存储数据
      await cacheManager.set('user:123', testData, 1800);
      
      // 验证存储后的状态
      const stats1 = cacheManager.getStats();
      expect(stats1.totalEntries).toBe(1);
      expect(stats1.memoryUsage).toBeGreaterThan(0);

      // 3. 验证检索参数
      const retrieveValidation = validateRetrieveArgs({
        key: 'user:123'
      });
      expect(retrieveValidation.isValid).toBe(true);

      // 4. 检索数据
      const retrieved = await cacheManager.get('user:123');
      expect(retrieved).toEqual(testData);

      // 验证命中统计
      const stats2 = cacheManager.getStats();
      expect(stats2.hits).toBe(1);
      expect(stats2.misses).toBe(0);

      // 5. 验证删除参数
      const deleteValidation = validateClearArgs({
        key: 'user:123'
      });
      expect(deleteValidation.isValid).toBe(true);

      // 6. 删除数据
      const deleteSuccess = await cacheManager.delete('user:123');
      expect(deleteSuccess).toBe(true);

      // 验证删除后的状态
      const stats3 = cacheManager.getStats();
      expect(stats3.totalEntries).toBe(0);
      expect(stats3.memoryUsage).toBe(0);

      // 7. 尝试再次检索（应该失败）
      const retrievedAfterDelete = await cacheManager.get('user:123');
      expect(retrievedAfterDelete).toBeUndefined();

      const stats4 = cacheManager.getStats();
      expect(stats4.misses).toBe(1);
    });

    test('应该正确处理TTL过期', async () => {
      const testValue = 'expires-soon';
      const shortTTL = 0.1; // 100ms

      await cacheManager.set('expiring-key', testValue, shortTTL);
      
      // 立即检索应该成功
      expect(await cacheManager.get('expiring-key')).toBe(testValue);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 150));

      // 过期后检索应该返回undefined
      expect(await cacheManager.get('expiring-key')).toBeUndefined();

      // 统计应该反映未命中
      const stats = cacheManager.getStats();
      expect(stats.misses).toBeGreaterThan(0);
    });

    test('应该处理内存限制和LRU驱逐', async () => {
      // 创建内存限制较小的缓存管理器
      const smallMemoryCache = new CacheManager({
        maxEntries: 100,
        maxMemory: 1024, // 1KB
        defaultTTL: 3600,
        preciseMemoryCalculation: true
      });

      try {
        // 添加一些数据直到接近内存限制
        const largeValue = 'x'.repeat(200); // 大约200字节的值
        
        await smallMemoryCache.set('item1', largeValue);
        await smallMemoryCache.set('item2', largeValue);
        await smallMemoryCache.set('item3', largeValue);
        
        // 检查所有项目都存在
        expect(await smallMemoryCache.get('item1')).toBe(largeValue);
        expect(await smallMemoryCache.get('item2')).toBe(largeValue);
        expect(await smallMemoryCache.get('item3')).toBe(largeValue);
        
        // 添加更多数据，应该触发LRU驱逐
        await smallMemoryCache.set('item4', largeValue);
        await smallMemoryCache.set('item5', largeValue);
        
        // 检查内存使用是否在限制内
        const stats = smallMemoryCache.getStats();
        expect(stats.memoryUsage).toBeLessThanOrEqual(1024);
        
        // 最早的项目应该被驱逐
        expect(await smallMemoryCache.get('item1')).toBeUndefined();
        expect(await smallMemoryCache.get('item2')).toBeUndefined();
        
        // 最新的项目应该仍然存在
        expect(await smallMemoryCache.get('item4')).toBe(largeValue);
        expect(await smallMemoryCache.get('item5')).toBe(largeValue);

      } finally {
        await smallMemoryCache.destroy();
      }
    });

    test('应该处理并发操作', async () => {
      const concurrentOps = 50;
      const promises: Promise<any>[] = [];

      // 创建混合的并发操作
      for (let i = 0; i < concurrentOps; i++) {
        if (i % 3 === 0) {
          // 存储操作
          promises.push(
            cacheManager.set(`concurrent-key-${i}`, `value-${i}`)
          );
        } else if (i % 3 === 1) {
          // 检索操作（可能命中也可能未命中）
          promises.push(
            cacheManager.get(`concurrent-key-${i - 1}`)
          );
        } else {
          // 删除操作
          promises.push(
            cacheManager.delete(`concurrent-key-${i - 2}`)
          );
        }
      }

      // 等待所有操作完成
      const results = await Promise.all(promises);
      
      // 验证没有操作失败
      expect(results).toHaveLength(concurrentOps);

      // 验证统计数据一致性
      const stats = cacheManager.getStats();
      expect(stats.totalEntries).toBeGreaterThanOrEqual(0);
      expect(stats.memoryUsage).toBeGreaterThanOrEqual(0);
    });

    test('应该正确计算和使用内存统计', async () => {
      const testData = {
        largeString: 'x'.repeat(1000),
        complexObject: {
          nested: {
            deeply: {
              nested: Array(100).fill('item')
            }
          }
        },
        numbers: Array(50).fill(0).map((_, i) => i),
        metadata: {
          created: new Date(),
          tags: ['test', 'memory', 'calculation']
        }
      };

      // 计算预期内存使用
      const memoryInfo = calculateMemoryUsageAdaptive('memory-test', testData, {
        precise: true
      });

      await cacheManager.set('memory-test', testData);

      const stats = cacheManager.getStats();
      expect(stats.totalEntries).toBe(1);
      
      // 内存使用应该与计算的大致相符
      expect(stats.memoryUsage).toBeGreaterThan(memoryInfo.totalSize * 0.8);
      expect(stats.memoryUsage).toBeLessThan(memoryInfo.totalSize * 1.2);
    });

    test('应该处理无效输入和边界情况', async () => {
      // 测试无效键
      await expect(
        cacheManager.set('', 'value')
      ).rejects.toThrow();

      await expect(
        cacheManager.set('invalid@key', 'value')
      ).rejects.toThrow();

      // 测试无效值
      await expect(
        cacheManager.set('valid-key', undefined)
      ).rejects.toThrow();

      // 测试无效TTL
      await expect(
        cacheManager.set('valid-key', 'value', -1)
      ).rejects.toThrow();

      await expect(
        cacheManager.set('valid-key', 'value', 31536001) // 超过1年
      ).rejects.toThrow();

      // 测试不存在的键
      expect(await cacheManager.get('non-existent')).toBeUndefined();
      expect(await cacheManager.delete('non-existent')).toBe(false);

      // 验证错误操作不影响统计
      const stats = cacheManager.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.memoryUsage).toBe(0);
    });
  });

  describe('压力测试', () => {
    test('应该处理大量连续操作', async () => {
      const operations = 1000;
      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        await cacheManager.set(`stress-key-${i}`, `value-${i}`);
        
        if (i % 2 === 0) {
          await cacheManager.get(`stress-key-${i}`);
        }
        
        if (i % 5 === 0 && i > 0) {
          await cacheManager.delete(`stress-key-${i - 5}`);
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // 验证性能在可接受范围内
      expect(duration).toBeLessThan(5000); // 5秒内完成

      const stats = cacheManager.getStats();
      expect(stats.totalEntries).toBeGreaterThan(0);
      expect(stats.hits + stats.misses).toBeGreaterThan(0);
    });

    test('应该在高内存使用情况下保持稳定', async () => {
      // 创建大量数据但不超过内存限制
      const itemCount = 100;
      const itemSize = 1024; // 1KB per item

      for (let i = 0; i < itemCount; i++) {
        const largeValue = 'x'.repeat(itemSize);
        await cacheManager.set(`large-item-${i}`, largeValue);
      }

      const stats = cacheManager.getStats();
      expect(stats.totalEntries).toBeLessThanOrEqual(itemCount);
      expect(stats.memoryUsage).toBeLessThanOrEqual(10 * 1024 * 1024); // 不超过配置的10MB

      // 验证最近的项目仍然可以访问
      for (let i = Math.max(0, itemCount - 10); i < itemCount; i++) {
        const value = await cacheManager.get(`large-item-${i}`);
        if (value !== undefined) {
          expect(value).toBe('x'.repeat(itemSize));
        }
      }
    });
  });

  describe('数据完整性', () => {
    test('应该保持复杂数据结构的完整性', async () => {
      const complexData = {
        primitives: {
          string: 'Hello, 世界!',
          number: 3.141592653589793,
          boolean: true,
          null: null,
          undefined: undefined
        },
        collections: {
          array: [1, 'two', { three: 3 }, [4, 5]],
          object: {
            nested: {
              deeply: {
                level4: 'deep value'
              }
            }
          }
        },
        specialTypes: {
          date: new Date('2024-01-01T00:00:00Z'),
          regex: /test.*pattern/gi
        },
        unicode: {
          emoji: '🚀🔥💯',
          chinese: '测试中文字符',
          special: '\n\t\r\u0000\uffff'
        }
      };

      await cacheManager.set('complex-data', complexData);
      const retrieved = await cacheManager.get('complex-data');

      // 深度比较所有属性
      expect(retrieved.primitives.string).toBe(complexData.primitives.string);
      expect(retrieved.primitives.number).toBe(complexData.primitives.number);
      expect(retrieved.primitives.boolean).toBe(complexData.primitives.boolean);
      expect(retrieved.primitives.null).toBe(complexData.primitives.null);
      
      expect(retrieved.collections.array).toEqual(complexData.collections.array);
      expect(retrieved.collections.object).toEqual(complexData.collections.object);
      
      expect(retrieved.unicode.emoji).toBe(complexData.unicode.emoji);
      expect(retrieved.unicode.chinese).toBe(complexData.unicode.chinese);
      expect(retrieved.unicode.special).toBe(complexData.unicode.special);
    });

    test('应该正确处理大型数据结构', async () => {
      const largeArray = Array(1000).fill(0).map((_, i) => ({
        id: i,
        data: `item-${i}`,
        metadata: {
          created: new Date(),
          tags: [`tag-${i % 10}`, `category-${i % 5}`],
          properties: {
            active: i % 2 === 0,
            score: Math.random() * 100,
            nested: {
              level1: {
                level2: {
                  value: `nested-${i}`
                }
              }
            }
          }
        }
      }));

      await cacheManager.set('large-array', largeArray);
      const retrieved = await cacheManager.get('large-array');

      expect(retrieved).toHaveLength(1000);
      expect(retrieved[0]).toEqual(largeArray[0]);
      expect(retrieved[999]).toEqual(largeArray[999]);
      
      // 验证随机项目
      const randomIndex = Math.floor(Math.random() * 1000);
      expect(retrieved[randomIndex]).toEqual(largeArray[randomIndex]);
    });
  });

  describe('统计精确性', () => {
    test('应该准确跟踪所有统计信息', async () => {
      // 重置统计
      await cacheManager.clear();
      
      const initialStats = cacheManager.getStats();
      expect(initialStats.totalEntries).toBe(0);
      expect(initialStats.memoryUsage).toBe(0);
      expect(initialStats.hits).toBe(0);
      expect(initialStats.misses).toBe(0);
      expect(initialStats.hitRate).toBe(0);

      // 执行一系列已知操作
      await cacheManager.set('stats-test-1', 'value1');
      await cacheManager.set('stats-test-2', 'value2');
      await cacheManager.set('stats-test-3', 'value3');

      // 3次命中
      await cacheManager.get('stats-test-1');
      await cacheManager.get('stats-test-2');
      await cacheManager.get('stats-test-3');

      // 2次未命中
      await cacheManager.get('non-existent-1');
      await cacheManager.get('non-existent-2');

      // 删除1个项目
      await cacheManager.delete('stats-test-1');

      const finalStats = cacheManager.getStats();
      expect(finalStats.totalEntries).toBe(2);
      expect(finalStats.memoryUsage).toBeGreaterThan(0);
      expect(finalStats.hits).toBe(3);
      expect(finalStats.misses).toBe(2);
      expect(finalStats.hitRate).toBe(60); // 3/(3+2) = 0.6 = 60%
      expect(finalStats.avgAccessTime).toBeGreaterThan(0);
    });
  });
});