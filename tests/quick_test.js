#!/usr/bin/env node

/**
 * 快速测试关键功能
 */

import { CacheManager } from './build/CacheManager.js';
import { ErrorHandler, CircuitBreakerState } from './build/errorHandler.js';

async function quickTest() {
  console.log('🧪 快速功能测试...\n');
  
  // 测试 CacheManager 基本功能
  console.log('1. 测试 CacheManager 基本功能...');
  const config = {
    maxEntries: 100,
    maxMemory: 10 * 1024 * 1024,
    defaultTTL: 3600,
    checkInterval: 5000,
    statsInterval: 2000,
    preciseMemoryCalculation: true
  };
  
  const cache = new CacheManager(config);
  
  // 基本缓存操作
  await cache.set('test-key', { data: 'test-value' });
  const value = await cache.get('test-key');
  console.log('✓ 基本缓存操作:', value?.data === 'test-value');
  
  // 批量操作
  const batchItems = [
    { key: 'batch1', value: 'value1' },
    { key: 'batch2', value: 'value2' },
    { key: 'batch3', value: 'value3' }
  ];
  
  const batchResult = await cache.setMany(batchItems);
  console.log('✓ 批量设置:', batchResult.success.length === 3);
  
  const batchGet = await cache.getMany(['batch1', 'batch2']);
  console.log('✓ 批量获取:', batchGet.success.length === 2);
  
  // GC测试
  const gcStats = cache.getGCStats();
  console.log('✓ GC统计获取:', typeof gcStats.currentPressureLevel === 'string');
  
  // 手动GC
  const gcResult = await cache.forceGC(false);
  console.log('✓ 手动GC:', typeof gcResult.duration === 'number');
  
  await cache.destroy();
  
  // 测试 ErrorHandler 功能
  console.log('\n2. 测试 ErrorHandler 功能...');
  const errorHandler = ErrorHandler.getInstance();
  
  // 断路器测试
  const breaker = errorHandler.getCircuitBreaker('test-service', {
    failureThreshold: 2,
    recoveryTimeout: 1000
  });
  
  console.log('✓ 断路器创建:', breaker.getState() === CircuitBreakerState.CLOSED);
  
  // 模拟失败
  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(async () => {
        throw new Error('test error');
      });
    } catch (e) {
      // 忽略预期的错误
    }
  }
  
  console.log('✓ 断路器开启:', breaker.getState() === CircuitBreakerState.OPEN);
  
  // 重试机制测试
  let attempts = 0;
  try {
    const result = await errorHandler.executeWithRetry(async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('retry test');
      }
      return 'success';
    }, {
      maxAttempts: 3,
      initialDelay: 10
    });
    console.log('✓ 重试机制:', result === 'success' && attempts === 2);
  } catch (e) {
    console.log('✗ 重试机制失败:', e.message);
  }
  
  // 系统健康检查
  const health = errorHandler.getSystemHealth();
  console.log('✓ 系统健康检查:', typeof health.overall === 'string');
  
  console.log('\n🎉 快速测试完成！');
}

quickTest().catch(error => {
  console.error('❌ 测试失败:', error.message);
  process.exit(1);
});