#!/usr/bin/env node

/**
 * 测试新增功能的脚本
 */

import { CacheManager } from './build/CacheManager.js';
import { ErrorHandler, CircuitBreakerState } from './build/errorHandler.js';
import { globalMonitoring } from './build/monitoring.js';
import { globalConfigManager } from './build/configManager.js';

async function testCacheManagerFeatures() {
  console.log('\n🧪 测试 CacheManager 新增功能...');
  
  const config = {
    maxEntries: 100,
    maxMemory: 10 * 1024 * 1024, // 10MB
    defaultTTL: 3600,
    checkInterval: 5000,
    statsInterval: 2000,
    preciseMemoryCalculation: true
  };
  
  const cache = new CacheManager(config);
  
  // 测试批量操作
  console.log('\n📦 测试批量操作...');
  const batchItems = Array.from({ length: 20 }, (_, i) => ({
    key: `batch-key-${i}`,
    value: { id: i, data: `test-data-${i}`, timestamp: Date.now() },
    ttl: 300
  }));
  
  const batchResult = await cache.setMany(batchItems);
  console.log(`批量设置结果: 成功 ${batchResult.success.length} 个, 失败 ${batchResult.failed.length} 个`);
  
  // 测试批量获取
  const batchKeys = batchItems.slice(0, 10).map(item => item.key);
  const batchGetResult = await cache.getMany(batchKeys);
  console.log(`批量获取结果: 成功 ${batchGetResult.success.length} 个, 失败 ${batchGetResult.failed.length} 个`);
  
  // 测试内存压力和GC
  console.log('\n🗑️ 测试垃圾回收功能...');
  
  // 获取GC统计
  const gcStats = cache.getGCStats();
  console.log('GC统计:', JSON.stringify(gcStats, null, 2));
  
  // 设置内存压力阈值
  cache.setMemoryPressureThresholds({
    medium: 0.6,
    high: 0.8,
    critical: 0.9
  });
  console.log('已设置新的内存压力阈值');
  
  // 强制触发GC
  const gcResult = await cache.forceGC(false);
  console.log('手动GC结果:', JSON.stringify(gcResult, null, 2));
  
  // 测试版本感知缓存
  console.log('\n🔄 测试版本感知缓存...');
  cache.enableVersionAware();
  
  await cache.set('version-key', { data: 'version 1' }, undefined, {
    version: '1.0.0',
    sourceFile: __filename,
    dependencies: [__filename]
  });
  
  const versionData = await cache.get('version-key');
  console.log('版本感知缓存读取:', versionData);
  
  // 测试缓存预热
  console.log('\n🔥 测试缓存预热...');
  await cache.preheatKeys(['batch-key-0', 'batch-key-1', 'batch-key-2']);
  const hotKeys = cache.getHotKeys(5);
  console.log('热点键:', hotKeys);
  
  await cache.destroy();
  console.log('✅ CacheManager 功能测试完成');
}

async function testErrorHandlerFeatures() {
  console.log('\n🛡️ 测试 ErrorHandler 新增功能...');
  
  const errorHandler = ErrorHandler.getInstance();
  
  // 测试断路器
  console.log('\n⚡ 测试断路器功能...');
  const breaker = errorHandler.getCircuitBreaker('test-service', {
    failureThreshold: 3,
    recoveryTimeout: 5000,
    halfOpenMaxCalls: 2
  });
  
  console.log('断路器初始状态:', breaker.getState());
  
  // 模拟失败操作触发断路器
  for (let i = 0; i < 4; i++) {
    try {
      await breaker.execute(async () => {
        throw new Error(`模拟失败 ${i + 1}`);
      });
    } catch (error) {
      console.log(`操作 ${i + 1} 失败:`, error.message);
    }
  }
  
  console.log('断路器失败后状态:', breaker.getState());
  console.log('断路器统计:', breaker.getStats());
  
  // 测试重试机制
  console.log('\n🔄 测试重试机制...');
  let attempts = 0;
  try {
    await errorHandler.executeWithRetry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`重试测试失败 ${attempts}`);
      }
      return `成功于第 ${attempts} 次尝试`;
    }, {
      maxAttempts: 5,
      initialDelay: 100,
      backoffMultiplier: 1.5
    });
    console.log(`重试机制测试成功，总尝试次数: ${attempts}`);
  } catch (error) {
    console.log('重试机制测试失败:', error.message);
  }
  
  // 测试系统健康状态
  console.log('\n💊 测试系统健康状态...');
  const health = errorHandler.getSystemHealth();
  console.log('系统健康状态:', JSON.stringify(health, null, 2));
  
  // 重置断路器
  errorHandler.resetAllCircuitBreakers();
  console.log('已重置所有断路器');
  
  console.log('✅ ErrorHandler 功能测试完成');
}

async function testMonitoringFeatures() {
  console.log('\n📊 测试监控功能...');
  
  // 记录一些监控数据
  for (let i = 0; i < 10; i++) {
    globalMonitoring.recordRequest(true, Math.random() * 100);
    globalMonitoring.recordCacheOperation(Math.random() > 0.7 ? 'miss' : 'hit');
  }
  
  // 获取当前指标
  const metrics = globalMonitoring.getCurrentMetrics();
  console.log('当前监控指标:', JSON.stringify(metrics, null, 2));
  
  // 获取性能趋势
  const trends = globalMonitoring.getPerformanceTrends();
  console.log('性能趋势分析:', JSON.stringify(trends, null, 2));
  
  // 添加告警规则
  const alertRule = {
    id: 'high-error-rate',
    name: '高错误率告警',
    condition: {
      metric: 'errorRate',
      operator: '>',
      threshold: 0.1
    },
    severity: 'HIGH',
    enabled: true,
    cooldownMs: 60000,
    description: '当错误率超过10%时触发告警'
  };
  
  globalMonitoring.addAlertRule(alertRule);
  console.log('已添加告警规则');
  
  // 获取Dashboard数据
  const dashboard = globalMonitoring.getDashboardData();
  console.log('Dashboard数据:', JSON.stringify(dashboard, null, 2));
  
  console.log('✅ 监控功能测试完成');
}

async function testConfigManagerFeatures() {
  console.log('\n⚙️ 测试配置管理功能...');
  
  // 添加配置变更监听器
  globalConfigManager.addChangeListener((config, changes) => {
    console.log('配置变更事件:', changes);
  });
  
  // 创建配置档案
  const profile = {
    name: 'high-performance',
    description: '高性能配置档案',
    config: {
      maxEntries: 2000,
      maxMemory: 50 * 1024 * 1024,
      checkInterval: 30000
    },
    conditions: {
      memoryUsage: { operator: '<', threshold: 0.8 }
    },
    priority: 10
  };
  
  globalConfigManager.addProfile(profile);
  console.log('已添加配置档案');
  
  // 获取当前配置
  const currentConfig = globalConfigManager.getCurrentConfig();
  console.log('当前配置:', JSON.stringify(currentConfig, null, 2));
  
  console.log('✅ 配置管理功能测试完成');
}

async function runAllTests() {
  console.log('🚀 开始测试所有新增功能...\n');
  
  try {
    await testCacheManagerFeatures();
    await testErrorHandlerFeatures();
    await testMonitoringFeatures();
    await testConfigManagerFeatures();
    
    console.log('\n🎉 所有功能测试完成！');
  } catch (error) {
    console.error('\n❌ 测试过程中出现错误:', error);
    process.exit(1);
  }
}

// 运行测试
runAllTests().catch(error => {
  console.error('测试脚本执行失败:', error);
  process.exit(1);
});