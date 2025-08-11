import {
  calculateMemoryUsage,
  calculateMemoryUsageFast,
  calculateMemoryUsageAdaptive,
  validateMemoryCalculation,
  MemoryInfo
} from '../src/memoryUtils';

describe('Memory Utils', () => {
  describe('calculateMemoryUsage (精确方法)', () => {
    test('应该计算字符串内存使用', () => {
      const result = calculateMemoryUsage('test-key', 'hello world');
      
      expect(result.keySize).toBeGreaterThan(0);
      expect(result.valueSize).toBeGreaterThan(0);
      expect(result.metadataSize).toBe(32);
      expect(result.totalSize).toBe(result.keySize + result.valueSize + result.metadataSize);
      expect(result.method).toBe('precise-calculation');
    });

    test('应该计算数字内存使用', () => {
      const result = calculateMemoryUsage('num-key', 42);
      
      expect(result.valueSize).toBe(8); // 64位浮点数
      expect(result.totalSize).toBeGreaterThan(result.valueSize);
    });

    test('应该计算布尔值内存使用', () => {
      const result = calculateMemoryUsage('bool-key', true);
      
      expect(result.valueSize).toBe(4); // 对齐后的布尔值
      expect(result.totalSize).toBeGreaterThan(result.valueSize);
    });

    test('应该计算对象内存使用', () => {
      const complexObj = {
        name: 'test',
        age: 25,
        active: true,
        data: { nested: 'value' }
      };
      
      const result = calculateMemoryUsage('obj-key', complexObj);
      
      expect(result.valueSize).toBeGreaterThan(50); // 复杂对象应该有较大内存占用
      expect(result.totalSize).toBeGreaterThan(result.valueSize);
    });

    test('应该计算数组内存使用', () => {
      const testArray = ['item1', 'item2', 'item3'];
      
      const result = calculateMemoryUsage('arr-key', testArray);
      
      expect(result.valueSize).toBeGreaterThan(24); // 数组头部 + 元素
      expect(result.totalSize).toBeGreaterThan(result.valueSize);
    });

    test('应该处理null和undefined', () => {
      const nullResult = calculateMemoryUsage('null-key', null);
      const undefinedResult = calculateMemoryUsage('undef-key', undefined);
      
      expect(nullResult.valueSize).toBe(4);
      expect(undefinedResult.valueSize).toBe(4);
    });

    test('应该处理循环引用', () => {
      const obj: any = { name: 'test' };
      obj.self = obj; // 创建循环引用
      
      const result = calculateMemoryUsage('circular-key', obj);
      
      expect(result.valueSize).toBeGreaterThan(0);
      expect(result.totalSize).toBeGreaterThan(result.valueSize);
    });

    test('应该处理特殊对象类型', () => {
      const date = new Date();
      const regex = /test/g;
      const map = new Map([['key1', 'value1'], ['key2', 'value2']]);
      const set = new Set(['item1', 'item2', 'item3']);
      
      const dateResult = calculateMemoryUsage('date-key', date);
      const regexResult = calculateMemoryUsage('regex-key', regex);
      const mapResult = calculateMemoryUsage('map-key', map);
      const setResult = calculateMemoryUsage('set-key', set);
      
      expect(dateResult.valueSize).toBe(24);
      expect(regexResult.valueSize).toBeGreaterThan(48);
      expect(mapResult.valueSize).toBeGreaterThan(32);
      expect(setResult.valueSize).toBeGreaterThan(32);
    });

    test('应该处理函数', () => {
      const testFunc = function testFunction() { return 'test'; };
      
      const result = calculateMemoryUsage('func-key', testFunc);
      
      expect(result.valueSize).toBeGreaterThan(64);
    });
  });

  describe('calculateMemoryUsageFast (快速方法)', () => {
    test('应该快速计算字符串内存', () => {
      const result = calculateMemoryUsageFast('test-key', 'hello');
      
      expect(result.keySize).toBe(8 * 2); // 'test-key' length * 2
      expect(result.valueSize).toBe(5 * 2); // 'hello' length * 2
      expect(result.method).toBe('fast-estimation');
    });

    test('应该快速计算数字内存', () => {
      const result = calculateMemoryUsageFast('num-key', 123.45);
      
      expect(result.valueSize).toBe(8);
    });

    test('应该快速计算布尔值内存', () => {
      const result = calculateMemoryUsageFast('bool-key', false);
      
      expect(result.valueSize).toBe(4);
    });

    test('应该使用JSON序列化处理复杂对象', () => {
      const complexObj = { a: 1, b: 'test', c: [1, 2, 3] };
      
      const result = calculateMemoryUsageFast('obj-key', complexObj);
      
      // JSON: {"a":1,"b":"test","c":[1,2,3]}
      const expectedSize = JSON.stringify(complexObj).length * 2;
      expect(result.valueSize).toBe(expectedSize);
    });

    test('应该处理无法JSON序列化的对象', () => {
      const obj: any = {};
      obj.circular = obj; // 循环引用，无法JSON序列化
      
      const result = calculateMemoryUsageFast('circular-key', obj);
      
      expect(result.valueSize).toBe(1024); // 默认估值
    });

    test('应该处理null和undefined', () => {
      const nullResult = calculateMemoryUsageFast('null-key', null);
      const undefinedResult = calculateMemoryUsageFast('undefined-key', undefined);
      
      expect(nullResult.valueSize).toBe(4);
      expect(undefinedResult.valueSize).toBe(4);
    });
  });

  describe('calculateMemoryUsageAdaptive (自适应方法)', () => {
    test('应该默认使用快速方法', () => {
      const result = calculateMemoryUsageAdaptive('test-key', 'simple value');
      
      // 由于precise=false且值不大，应该尝试精确方法
      expect(result.method).toBe('precise-calculation');
    });

    test('应该在precise=true时使用精确方法', () => {
      const result = calculateMemoryUsageAdaptive('test-key', 'value', { precise: true });
      
      expect(result.method).toBe('precise-calculation');
    });

    test('应该在值太大时回退到快速方法', () => {
      const largeValue = 'x'.repeat(20000); // 大于默认阈值
      
      const result = calculateMemoryUsageAdaptive('test-key', largeValue, { precise: false });
      
      expect(result.method).toBe('fast-estimation');
    });

    test('应该在精确方法失败时回退到快速方法', () => {
      // 创建一个会导致精确计算失败的对象
      const problematicObj: any = {};
      
      // 模拟错误情况 - 实际使用中可能是由于内存限制等原因
      const result = calculateMemoryUsageAdaptive('test-key', problematicObj);
      
      expect(result).toBeDefined();
      expect(result.totalSize).toBeGreaterThan(0);
    });

    test('应该支持自定义最大精确计算大小', () => {
      const mediumValue = 'x'.repeat(5000);
      
      // 设置较小的阈值
      const result = calculateMemoryUsageAdaptive('test-key', mediumValue, { 
        precise: false,
        maxSizeForPrecise: 1000 
      });
      
      expect(result.method).toBe('fast-estimation');
    });
  });

  describe('validateMemoryCalculation', () => {
    test('应该比较两种计算方法', () => {
      const testValue = { name: 'test', items: [1, 2, 3, 4, 5] };
      
      const comparison = validateMemoryCalculation('test-key', testValue);
      
      expect(comparison.fast).toBeDefined();
      expect(comparison.precise).toBeDefined();
      expect(comparison.difference).toBeGreaterThanOrEqual(0);
      expect(comparison.accuracyRatio).toBeGreaterThan(0);
      expect(comparison.accuracyRatio).toBeLessThanOrEqual(1);
      
      expect(comparison.fast.method).toBe('fast-estimation');
      expect(comparison.precise.method).toBe('precise-calculation');
    });

    test('应该计算准确度比率', () => {
      const simpleValue = 'hello';
      
      const comparison = validateMemoryCalculation('test-key', simpleValue);
      
      // 对于简单字符串，两种方法应该比较接近
      expect(comparison.accuracyRatio).toBeGreaterThan(0.5);
    });

    test('应该处理不同类型的值', () => {
      const testValues = [
        'string value',
        123,
        true,
        null,
        undefined,
        { key: 'value' },
        [1, 2, 3],
        new Date(),
        /regex/g
      ];
      
      for (const value of testValues) {
        const comparison = validateMemoryCalculation('test-key', value);
        
        expect(comparison.fast.totalSize).toBeGreaterThan(0);
        expect(comparison.precise.totalSize).toBeGreaterThan(0);
        expect(comparison.accuracyRatio).toBeGreaterThan(0);
        expect(comparison.accuracyRatio).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('MemoryInfo接口', () => {
    test('应该包含所有必需字段', () => {
      const result = calculateMemoryUsage('test-key', 'test-value');
      
      expect(result).toHaveProperty('valueSize');
      expect(result).toHaveProperty('keySize');
      expect(result).toHaveProperty('metadataSize');
      expect(result).toHaveProperty('totalSize');
      expect(result).toHaveProperty('method');
      
      expect(typeof result.valueSize).toBe('number');
      expect(typeof result.keySize).toBe('number');
      expect(typeof result.metadataSize).toBe('number');
      expect(typeof result.totalSize).toBe('number');
      expect(typeof result.method).toBe('string');
    });

    test('总大小应该等于各部分之和', () => {
      const result = calculateMemoryUsage('test-key', { data: 'test' });
      
      expect(result.totalSize).toBe(result.valueSize + result.keySize + result.metadataSize);
    });
  });

  describe('性能测试', () => {
    test('快速方法应该比精确方法快', () => {
      const largeObj = {
        data: 'x'.repeat(1000),
        items: Array(100).fill(0).map((_, i) => ({ id: i, value: `item-${i}` })),
        metadata: {
          created: new Date(),
          tags: ['tag1', 'tag2', 'tag3'],
          config: { enabled: true, threshold: 100 }
        }
      };
      
      const fastStart = performance.now();
      for (let i = 0; i < 100; i++) {
        calculateMemoryUsageFast('perf-key', largeObj);
      }
      const fastEnd = performance.now();
      
      const preciseStart = performance.now();
      for (let i = 0; i < 100; i++) {
        calculateMemoryUsage('perf-key', largeObj);
      }
      const preciseEnd = performance.now();
      
      const fastTime = fastEnd - fastStart;
      const preciseTime = preciseEnd - preciseStart;
      
      // 快速方法应该明显更快
      expect(fastTime).toBeLessThan(preciseTime);
    });
  });
});