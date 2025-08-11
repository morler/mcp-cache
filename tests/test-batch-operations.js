#!/usr/bin/env node

import { CacheManager } from '../build/CacheManager.js';

async function testBatchOperations() {
  console.log('🧪 开始测试批量操作功能...\n');

  // 创建缓存管理器
  const cache = new CacheManager({
    maxEntries: 100,
    maxMemory: 10 * 1024 * 1024, // 10MB
    defaultTTL: 3600
  });

  try {
    // 测试批量存储
    console.log('📝 测试批量存储...');
    const batchItems = [
      { key: 'user:1', value: { name: 'Alice', age: 30 }, ttl: 3600 },
      { key: 'user:2', value: { name: 'Bob', age: 25 }, ttl: 3600 },
      { key: 'user:3', value: { name: 'Charlie', age: 35 }, ttl: 3600 },
      { key: 'post:1', value: { title: 'Hello World', content: 'First post' }, ttl: 1800 }
    ];

    const storeResult = await cache.setMany(batchItems);
    console.log('✅ 批量存储结果:', {
      success: storeResult.success.length,
      failed: storeResult.failed.length,
      successKeys: storeResult.success,
      failed: storeResult.failed
    });

    // 测试批量获取
    console.log('\n🔍 测试批量获取...');
    const retrieveKeys = ['user:1', 'user:2', 'user:3', 'post:1', 'nonexistent'];
    const retrieveResult = await cache.getMany(retrieveKeys);
    console.log('✅ 批量获取结果:', {
      found: retrieveResult.found.length,
      missing: retrieveResult.missing.length,
      foundItems: retrieveResult.found.map(item => ({ key: item.key, value: item.value })),
      missingKeys: retrieveResult.missing
    });

    // 测试批量删除
    console.log('\n🗑️ 测试批量删除...');
    const deleteKeys = ['user:2', 'user:3', 'nonexistent'];
    const deleteResult = await cache.deleteMany(deleteKeys);
    console.log('✅ 批量删除结果:', {
      success: deleteResult.success.length,
      failed: deleteResult.failed.length,
      successKeys: deleteResult.success,
      failedKeys: deleteResult.failed
    });

    // 验证删除结果
    console.log('\n✅ 验证删除结果...');
    const verifyResult = await cache.getMany(['user:1', 'user:2', 'post:1']);
    console.log('删除后状态:', {
      user1: verifyResult.found.find(item => item.key === 'user:1') ? '存在' : '不存在',
      user2: verifyResult.found.find(item => item.key === 'user:2') ? '存在' : '不存在',
      post1: verifyResult.found.find(item => item.key === 'post:1') ? '存在' : '不存在'
    });

    // 测试错误处理
    console.log('\n🚨 测试错误处理...');
    
    // 测试空数组
    try {
      await cache.setMany([]);
      console.log('❌ 应该抛出错误');
    } catch (error) {
      console.log('✅ 空数组错误处理正常:', error.message);
    }

    // 测试无效键
    const invalidItems = [
      { key: '', value: 'test' },
      { key: 'valid', value: 'test' }
    ];
    const invalidResult = await cache.setMany(invalidItems);
    console.log('✅ 无效键处理结果:', {
      success: invalidResult.success.length,
      failed: invalidResult.failed.length,
      failedItems: invalidResult.failed
    });

    // 获取最终统计
    console.log('\n📊 最终缓存统计:');
    const stats = cache.getStats();
    console.log({
      totalEntries: stats.totalEntries,
      memoryUsage: `${(stats.memoryUsage / 1024).toFixed(2)} KB`,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: `${stats.hitRate.toFixed(2)}%`
    });

    console.log('\n🎉 批量操作功能测试完成！');

  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await cache.destroy();
  }
}

// 运行测试
testBatchOperations().catch(console.error);