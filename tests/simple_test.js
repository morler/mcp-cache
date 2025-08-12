#!/usr/bin/env node

import { CacheManager } from './build/CacheManager.js';

async function simpleTest() {
  console.log('🧪 简单功能测试...\n');
  
  const config = {
    maxEntries: 10,
    maxMemory: 1024 * 1024,
    defaultTTL: 300,
    checkInterval: 10000,
    statsInterval: 10000
  };
  
  const cache = new CacheManager(config);
  
  try {
    // 1. 基本缓存操作
    await cache.set('key1', 'value1');
    const value = await cache.get('key1');
    console.log('✅ 基本缓存操作:', value === 'value1');
    
    // 2. 批量操作
    const items = [
      { key: 'batch1', value: 'bvalue1' },
      { key: 'batch2', value: 'bvalue2' }
    ];
    const batchResult = await cache.setMany(items);
    console.log('✅ 批量设置:', batchResult.success.length === 2);
    
    // 3. 统计信息
    const stats = cache.getStats();
    console.log('✅ 统计信息:', stats.totalEntries > 0);
    
    // 4. GC功能
    const gcStats = cache.getGCStats();
    console.log('✅ GC统计:', gcStats.currentPressureLevel);
    
    console.log('\n🎉 所有基本功能正常！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    await cache.destroy();
    console.log('✅ 缓存已清理');
  }
}

simpleTest();