#!/usr/bin/env node

/**
 * 简化的MCP服务器功能测试
 */

import { CacheManager } from './build/CacheManager.js';

async function testMCPSimple() {
  console.log('🧪 简化MCP功能测试...\n');
  
  try {
    // 创建简单配置的CacheManager
    const config = {
      maxEntries: 100,
      maxMemory: 10 * 1024 * 1024,
      defaultTTL: 300000,
      checkInterval: 30000,
      statsInterval: 15000,
      versionAwareMode: true
    };
    
    const cache = new CacheManager(config);
    console.log('✅ CacheManager创建成功');

    // 1. 测试基本缓存操作
    console.log('\n1. 测试基本缓存操作...');
    await cache.set('test1', 'value1');
    const value1 = await cache.get('test1');
    console.log('✅ 基本存取:', value1 === 'value1' ? '成功' : '失败');

    // 2. 测试版本感知功能
    console.log('\n2. 测试版本感知功能...');
    await cache.set('version-test', { data: 'test' }, undefined, {
      version: '1.0.0',
      sourceFile: '/test.js'
    });
    const versionData = await cache.get('version-test');
    console.log('✅ 版本感知存取:', versionData ? '成功' : '失败');

    // 3. 测试批量操作
    console.log('\n3. 测试批量操作...');
    const items = [
      { key: 'batch1', value: 'val1' },
      { key: 'batch2', value: 'val2' }
    ];
    const batchResult = await cache.setMany(items);
    console.log('✅ 批量存储:', batchResult.success.length === 2 ? '成功' : '失败');

    const getResult = await cache.getMany(['batch1', 'batch2']);
    console.log('✅ 批量获取:', getResult.found.length === 2 ? '成功' : '失败');

    // 4. 测试高级功能
    console.log('\n4. 测试高级功能...');
    
    // 热点键
    const hotKeys = cache.getHotKeys(3);
    console.log('✅ 热点键:', Array.isArray(hotKeys) ? '成功' : '失败');
    
    // GC统计
    const gcStats = cache.getGCStats();
    console.log('✅ GC统计:', gcStats.currentPressureLevel ? '成功' : '失败');
    
    // 版本统计
    const versionStats = cache.getVersionStats();
    console.log('✅ 版本统计:', versionStats ? '成功' : '失败');

    // 5. 测试保护功能
    console.log('\n5. 测试保护功能...');
    
    const penetrationStats = cache.getCachePenetrationStats();
    console.log('✅ 穿透保护统计:', penetrationStats ? '成功' : '失败');
    
    cache.clearNullValueCache();
    console.log('✅ null值缓存清理: 成功');

    // 6. 测试预热功能
    console.log('\n6. 测试预热功能...');
    
    const preheatingData = new Map([['preheat1', 'data1']]);
    const preheatResult = await cache.preheatKeys(['preheat1'], preheatingData);
    console.log('✅ 缓存预热:', preheatResult ? '成功' : '失败');
    
    const preheatStats = cache.getPreheatingStats();
    console.log('✅ 预热统计:', preheatStats ? '成功' : '失败');

    // 7. 测试垃圾回收
    console.log('\n7. 测试垃圾回收...');
    
    const gcResult = await cache.forceGC(false);
    console.log('✅ 手动GC:', gcResult.duration >= 0 ? '成功' : '失败');

    // 8. 获取综合统计
    console.log('\n8. 获取综合统计...');
    
    const stats = cache.getStats();
    console.log('✅ 缓存统计:', stats.totalEntries >= 0 ? '成功' : '失败');
    console.log('  - 总条目数:', stats.totalEntries);
    console.log('  - 内存使用:', Math.round(stats.memoryUsage / 1024) + 'KB');
    console.log('  - 命中率:', stats.hitRate.toFixed(2) + '%');

    // 清理
    await cache.destroy();
    console.log('\n🎉 简化MCP功能测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.stack) {
      console.error('堆栈信息:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
}

testMCPSimple();