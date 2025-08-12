#!/usr/bin/env node

/**
 * 测试监控和配置管理模块
 */

import { MonitoringManager } from './build/monitoring.js';
import { ConfigManager } from './build/configManager.js';

async function testMonitoringAndConfig() {
  console.log('🧪 测试监控和配置管理模块...\n');
  
  try {
    // 1. 测试监控管理器基本功能
    console.log('1. 测试监控管理器基本功能...');
    
    const monitoring = MonitoringManager.getInstance();
    console.log('✅ 监控管理器实例化成功');
    
    // 记录一些缓存操作
    monitoring.recordCacheOperation('hit');
    monitoring.recordCacheOperation('miss');
    monitoring.recordCacheOperation('set');
    console.log('✅ 缓存操作记录成功');
    
    // 获取当前指标（可能为null，因为需要时间积累）
    const currentMetrics = monitoring.getCurrentMetrics();
    console.log('✅ 当前指标获取:', currentMetrics !== undefined ? '成功' : '暂无数据');
    
    // 获取性能趋势
    const trends = monitoring.getPerformanceTrends();
    console.log('✅ 性能趋势获取:', Array.isArray(trends) ? '成功' : '失败');
    
    // 2. 测试报警功能
    console.log('\n2. 测试报警功能...');
    
    // 添加一个测试报警规则
    const testRule = {
      id: 'test-rule-1',
      name: '测试报警规则',
      condition: 'cacheMetrics.hitRate < 50',
      severity: 'warning',
      enabled: true,
      description: '缓存命中率过低'
    };
    
    monitoring.addAlertRule(testRule);
    console.log('✅ 报警规则添加成功');
    
    // 获取报警规则
    const rules = monitoring.getAlertRules();
    console.log('✅ 报警规则获取:', rules.length > 0 ? '成功' : '失败');
    
    // 获取活跃报警
    const activeAlerts = monitoring.getActiveAlerts();
    console.log('✅ 活跃报警获取:', Array.isArray(activeAlerts) ? '成功' : '失败');
    
    // 3. 测试仪表板数据
    console.log('\n3. 测试仪表板数据...');
    
    const dashboardData = monitoring.getDashboardData();
    console.log('✅ 仪表板数据获取:', typeof dashboardData === 'object' ? '成功' : '失败');
    
    // 4. 测试系统健康状态
    console.log('\n4. 测试系统健康状态...');
    
    const systemHealth = monitoring.getSystemHealth();
    console.log('✅ 系统健康状态:', typeof systemHealth.overallStatus === 'string' ? '成功' : '失败');
    
    // 5. 测试配置管理器基本功能
    console.log('\n5. 测试配置管理器基本功能...');
    
    // 创建独立的配置管理器实例（避免全局实例的自动调优）
    const configManager = new ConfigManager('./test-config.json');
    console.log('✅ 配置管理器实例化成功');
    
    // 获取当前配置
    const currentConfig = configManager.getConfig();
    console.log('✅ 当前配置获取:', typeof currentConfig === 'object' ? '成功' : '失败');
    console.log('  - maxEntries:', currentConfig.maxEntries);
    console.log('  - maxMemory:', Math.round(currentConfig.maxMemory / (1024*1024)) + 'MB');
    
    // 6. 测试配置文件管理
    console.log('\n6. 测试配置文件管理...');
    
    const profiles = configManager.getProfiles();
    console.log('✅ 配置文件获取:', Array.isArray(profiles) ? '成功' : '失败');
    console.log('  - 配置文件数量:', profiles.length);
    
    if (profiles.length > 0) {
      const firstProfile = profiles[0];
      console.log('  - 第一个配置文件:', firstProfile.name, '-', firstProfile.description);
    }
    
    // 7. 测试配置更新
    console.log('\n7. 测试配置更新...');
    
    const updateConfig = { maxEntries: 1500 };
    configManager.updateConfig(updateConfig, 'USER', '测试更新');
    console.log('✅ 配置更新成功');
    
    const updatedConfig = configManager.getConfig();
    console.log('✅ 配置更新验证:', updatedConfig.maxEntries === 1500 ? '成功' : '失败');
    
    // 8. 测试配置变更历史
    console.log('\n8. 测试配置变更历史...');
    
    const changeHistory = configManager.getChangeHistory(5);
    console.log('✅ 配置变更历史:', Array.isArray(changeHistory) ? '成功' : '失败');
    console.log('  - 变更记录数量:', changeHistory.length);
    
    // 9. 测试自动调优配置
    console.log('\n9. 测试自动调优配置...');
    
    const autoTuneConfig = configManager.getAutoTuneConfig();
    console.log('✅ 自动调优配置获取:', typeof autoTuneConfig === 'object' ? '成功' : '失败');
    console.log('  - 自动调优启用:', autoTuneConfig.enabled);
    console.log('  - 检查间隔:', autoTuneConfig.checkInterval + 'ms');
    
    // 10. 测试配置建议
    console.log('\n10. 测试配置建议...');
    
    const recommendations = configManager.getConfigurationRecommendations();
    console.log('✅ 配置建议获取:', Array.isArray(recommendations) ? '成功' : '失败');
    console.log('  - 建议数量:', recommendations.length);
    
    // 11. 清理
    console.log('\n11. 清理测试资源...');
    
    monitoring.removeAlertRule('test-rule-1');
    console.log('✅ 测试报警规则清理成功');
    
    configManager.stop();
    console.log('✅ 配置管理器停止成功');
    
    console.log('\n🎉 监控和配置管理模块测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.stack) {
      console.error('堆栈信息:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
}

testMonitoringAndConfig();