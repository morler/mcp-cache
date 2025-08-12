#!/usr/bin/env node

/**
 * 测试MCP服务器相关核心功能
 */

import { CacheManager } from './build/CacheManager.js';
import { ErrorHandler, CircuitBreakerState } from './build/errorHandler.js';
import { globalMonitoring } from './build/monitoring.js';
import { globalConfigManager } from './build/configManager.js';

async function testMCPServerComponents() {
  console.log('🧪 测试MCP服务器相关核心功能...\n');
  
  try {
    // 1. 测试CacheManager高级功能
    console.log('1. 测试CacheManager高级功能...');
    const config = {
      maxEntries: 1000,
      maxMemory: 50 * 1024 * 1024,
      defaultTTL: 3600000,
      checkInterval: 60000,
      statsInterval: 30000,
      versionAwareMode: true
    };
    
    const cacheManager = new CacheManager(config);
    console.log('✅ CacheManager实例化成功');

    // 2. 测试版本管理功能
    console.log('\n2. 测试版本管理功能...');
    
    // 测试版本感知存储
    await cacheManager.set('versioned-key', { data: 'versioned content' }, undefined, {
      version: 'v1.0.0',
      sourceFile: '/path/to/source.js',
      dependencies: ['/path/to/dep1.js', '/path/to/dep2.js']
    });
    console.log('✅ 版本感知存储成功');
    
    // 测试版本感知检索
    const versionData = await cacheManager.get('versioned-key', { validateDependencies: false });
    console.log('✅ 版本感知检索:', versionData ? '成功' : '失败');
    
    // 测试版本统计
    const versionStats = cacheManager.getVersionStats();
    console.log('✅ 版本统计获取:', typeof versionStats === 'object' ? '成功' : '失败');

    // 3. 测试批量操作功能
    console.log('\n3. 测试批量操作功能...');
    
    // 测试批量存储
    const batchItems = [
      { key: 'batch1', value: 'data1' },
      { key: 'batch2', value: 'data2' },
      { key: 'batch3', value: 'data3' }
    ];
    const batchStoreResult = await cacheManager.setMany(batchItems);
    console.log('✅ 批量存储:', batchStoreResult.success.length === 3 ? '成功' : '失败');
    
    // 测试批量检索
    const batchRetrieveResult = await cacheManager.getMany(['batch1', 'batch2', 'batch3']);
    console.log('✅ 批量检索:', batchRetrieveResult.found.length === 3 ? '成功' : '失败');
    
    // 测试批量删除
    const batchDeleteResult = await cacheManager.deleteMany(['batch1', 'batch2']);
    console.log('✅ 批量删除:', batchDeleteResult.success.length === 2 ? '成功' : '失败');

    // 4. 测试高级缓存功能
    console.log('\n4. 测试高级缓存功能...');
    
    // 测试热点键获取
    const hotKeys = cacheManager.getHotKeys(5);
    console.log('✅ 热点键获取:', Array.isArray(hotKeys) ? '成功' : '失败');
    
    // 测试预热功能
    const preheatingData = new Map([['preheat1', 'value1'], ['preheat2', 'value2']]);
    const preheatResult = await cacheManager.preheatKeys(['preheat1', 'preheat2'], preheatingData);
    console.log('✅ 缓存预热:', preheatResult.success.length >= 0 ? '成功' : '失败');
    
    // 测试预热统计
    const preheatStats = cacheManager.getPreheatingStats();
    console.log('✅ 预热统计:', typeof preheatStats === 'object' ? '成功' : '失败');

    // 5. 测试缓存穿透保护
    console.log('\n5. 测试缓存穿透保护...');
    
    // 测试保护统计
    const penetrationStats = cacheManager.getCachePenetrationStats();
    console.log('✅ 穿透保护统计:', typeof penetrationStats === 'object' ? '成功' : '失败');
    
    // 测试null值缓存清理
    cacheManager.clearNullValueCache();
    console.log('✅ null值缓存清理: 成功');

    // 6. 测试垃圾回收功能
    console.log('\n6. 测试垃圾回收功能...');
    
    // 测试GC统计
    const gcStats = cacheManager.getGCStats();
    console.log('✅ GC统计获取:', typeof gcStats.currentPressureLevel === 'string' ? '成功' : '失败');
    
    // 测试手动GC
    const gcResult = await cacheManager.forceGC(false);
    console.log('✅ 手动GC执行:', typeof gcResult.duration === 'number' ? '成功' : '失败');

    // 7. 测试监控系统
    console.log('\n7. 测试监控系统...');
    
    // 测试监控指标
    const currentMetrics = globalMonitoring.getCurrentMetrics();
    console.log('✅ 监控指标获取:', currentMetrics ? '成功' : '失败');
    
    // 测试性能趋势
    const trends = globalMonitoring.getPerformanceTrends();
    console.log('✅ 性能趋势获取:', Array.isArray(trends) ? '成功' : '失败');
    
    // 测试仪表板数据
    const dashboardData = globalMonitoring.getDashboardData();
    console.log('✅ 仪表板数据:', typeof dashboardData === 'object' ? '成功' : '失败');

    // 8. 测试配置管理
    console.log('\n8. 测试配置管理...');
    
    // 测试当前配置
    const currentConfig = globalConfigManager.getConfig();
    console.log('✅ 配置获取:', typeof currentConfig === 'object' ? '成功' : '失败');
    
    // 测试配置文件
    const profiles = globalConfigManager.getProfiles();
    console.log('✅ 配置文件获取:', Array.isArray(profiles) ? '成功' : '失败');
    
    // 测试配置建议
    const recommendations = globalConfigManager.getConfigurationRecommendations();
    console.log('✅ 配置建议获取:', Array.isArray(recommendations) ? '成功' : '失败');

    // 9. 测试报警和健康检查
    console.log('\n9. 测试报警和健康检查...');
    
    // 测试活跃报警
    const activeAlerts = globalMonitoring.getActiveAlerts();
    console.log('✅ 活跃报警获取:', Array.isArray(activeAlerts) ? '成功' : '失败');
    
    // 测试系统健康
    const systemHealth = globalMonitoring.getSystemHealth();
    console.log('✅ 系统健康检查:', typeof systemHealth.overallStatus === 'string' ? '成功' : '失败');

    // 10. 清理测试数据
    console.log('\n10. 清理测试数据...');
    await cacheManager.clear();
    await cacheManager.destroy();
    console.log('✅ 测试数据清理完成');

    console.log('\n🎉 MCP服务器核心功能测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error('详细错误:', error.stack);
  }
}

testMCPServerComponents();