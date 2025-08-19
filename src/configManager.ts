/**
 * 配置管理和参数调优模块
 * 提供动态配置加载、验证、运行时调整和性能自动调优功能
 */

import { CacheConfig } from './types.js';
import { ErrorHandler, CacheErrorCode } from './errorHandler.js';
import { globalMonitoring } from './monitoring.js';
import { logger } from './logger.js';
import * as fs from 'fs-extra';
import * as fsCore from 'fs';
import * as path from 'path';

export interface ConfigValidationRule {
  field: string;
  type: 'number' | 'string' | 'boolean' | 'object' | 'array';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  validator?: (value: any) => boolean | string;
}

export interface ConfigProfile {
  name: string;
  description: string;
  config: Partial<CacheConfig>;
  conditions: {
    memoryUsage?: { operator: '>' | '<' | '>=' | '<=' | '=='; threshold: number };
    hitRate?: { operator: '>' | '<' | '>=' | '<=' | '=='; threshold: number };
    errorRate?: { operator: '>' | '<' | '>=' | '<=' | '=='; threshold: number };
    throughput?: { operator: '>' | '<' | '>=' | '<=' | '=='; threshold: number };
  };
  priority: number; // 优先级，数字越大优先级越高
}

export interface ConfigChangeEvent {
  timestamp: number;
  changes: Array<{
    field: string;
    oldValue: any;
    newValue: any;
    reason: string;
  }>;
  source: 'USER' | 'AUTO_TUNE' | 'PROFILE_SWITCH' | 'RELOAD';
  profile?: string;
}

export interface AutoTuneConfig {
  enabled: boolean;
  checkInterval: number; // 检查间隔（毫秒）
  minSampleSize: number; // 最小样本数量
  adaptationRate: number; // 适应速率（0-1）
  stabilityThreshold: number; // 稳定性阈值
  enabledParameters: string[]; // 允许自动调优的参数
}

export interface PerformanceMetrics {
  hitRate: number;
  memoryUtilization: number;
  averageResponseTime: number;
  throughput: number;
  errorRate: number;
  gcFrequency: number;
}

/**
 * 配置管理器
 */
export class ConfigManager {
  private static instance: ConfigManager;
  
  // 当前配置
  private currentConfig: CacheConfig;
  private baseConfig: CacheConfig;
  
  // 配置文件路径
  private configPath: string;
  private profilesPath: string;
  
  // 配置验证规则
  private validationRules: ConfigValidationRule[] = [
    { field: 'maxEntries', type: 'number', min: 1, max: 1000000 },
    { field: 'maxMemory', type: 'number', min: 1024 * 1024, max: 8 * 1024 * 1024 * 1024 },
    { field: 'defaultTTL', type: 'number', min: 1000, max: 24 * 60 * 60 * 1000 },
    { field: 'checkInterval', type: 'number', min: 1000, max: 300000 },
    { field: 'statsInterval', type: 'number', min: 1000, max: 300000 },
    { field: 'preciseMemoryCalculation', type: 'boolean' },
    { field: 'versionAwareMode', type: 'boolean' },
    { field: 'encryptionEnabled', type: 'boolean' },
    { 
      field: 'encryptionKey', 
      type: 'string', 
      validator: (value: string) => {
        if (!value) return true; // 可选字段
        return value.length >= 32 || '加密密钥长度至少32个字符';
      }
    }
  ];
  
  // 配置文件
  private profiles: Map<string, ConfigProfile> = new Map();
  private activeProfile?: string;
  
  // 配置变更历史
  private changeHistory: ConfigChangeEvent[] = [];
  private maxHistorySize: number = 100;
  
  // 自动调优
  private autoTuneConfig: AutoTuneConfig = {
    enabled: true,
    checkInterval: 60000, // 1分钟
    minSampleSize: 10,
    adaptationRate: 0.1,
    stabilityThreshold: 0.05,
    enabledParameters: ['maxEntries', 'defaultTTL', 'checkInterval']
  };
  
  private tuningTimer?: NodeJS.Timeout;
  private performanceHistory: PerformanceMetrics[] = [];
  private maxPerformanceHistory: number = 50;
  
  // 配置监听器
  private changeListeners: Array<(config: CacheConfig, changes: ConfigChangeEvent) => void> = [];
  
  private constructor(configPath: string = 'config.json') {
    this.configPath = path.resolve(configPath);
    this.profilesPath = path.resolve(path.dirname(configPath), 'config-profiles.json');
    
    // 默认配置
    this.baseConfig = this.currentConfig = {
      maxEntries: 1000,
      maxMemory: 100 * 1024 * 1024, // 100MB
      defaultTTL: 3600000, // 1小时
      checkInterval: 60000, // 1分钟
      statsInterval: 30000, // 30秒
      preciseMemoryCalculation: false,
      versionAwareMode: true,
      encryptionEnabled: false,
      accessControl: {
        allowedOperations: ['store_data', 'retrieve_data', 'clear_cache', 'get_cache_stats'],
        restrictedKeys: [],
        restrictedPatterns: []
      }
    };
    
    this.initializeDefaultProfiles();
    this.loadConfiguration();
    this.startAutoTuning();
  }
  
  static getInstance(configPath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configPath);
    }
    return ConfigManager.instance;
  }
  
  /**
   * 初始化默认配置文件
   */
  private initializeDefaultProfiles(): void {
    const profiles: ConfigProfile[] = [
      {
        name: 'high-performance',
        description: '高性能配置：优化吞吐量和响应时间',
        config: {
          maxEntries: 5000,
          maxMemory: 200 * 1024 * 1024,
          defaultTTL: 1800000, // 30分钟
          checkInterval: 30000,
          preciseMemoryCalculation: false
        },
        conditions: {
          throughput: { operator: '>', threshold: 100 }
        },
        priority: 8
      },
      {
        name: 'memory-optimized',
        description: '内存优化配置：降低内存使用',
        config: {
          maxEntries: 500,
          maxMemory: 50 * 1024 * 1024,
          defaultTTL: 1200000, // 20分钟
          checkInterval: 45000,
          preciseMemoryCalculation: true
        },
        conditions: {
          memoryUsage: { operator: '>', threshold: 85 }
        },
        priority: 7
      },
      {
        name: 'stability-focused',
        description: '稳定性配置：优化稳定性和错误率',
        config: {
          maxEntries: 2000,
          maxMemory: 150 * 1024 * 1024,
          defaultTTL: 2400000, // 40分钟
          checkInterval: 90000,
          preciseMemoryCalculation: true
        },
        conditions: {
          errorRate: { operator: '>', threshold: 2 }
        },
        priority: 6
      },
      {
        name: 'development',
        description: '开发环境配置：调试友好',
        config: {
          maxEntries: 100,
          maxMemory: 20 * 1024 * 1024,
          defaultTTL: 300000, // 5分钟
          checkInterval: 15000,
          preciseMemoryCalculation: true,
          versionAwareMode: true
        },
        conditions: {},
        priority: 2
      },
      {
        name: 'production',
        description: '生产环境配置：平衡性能和稳定性',
        config: {
          maxEntries: 3000,
          maxMemory: 256 * 1024 * 1024,
          defaultTTL: 3600000, // 1小时
          checkInterval: 60000,
          preciseMemoryCalculation: false,
          encryptionEnabled: true
        },
        conditions: {},
        priority: 5
      }
    ];
    
    for (const profile of profiles) {
      this.profiles.set(profile.name, profile);
    }
  }
  
  /**
   * 加载配置
   */
  async loadConfiguration(): Promise<void> {
    try {
      // 加载主配置文件
      if (await fs.pathExists(this.configPath)) {
        const configContent = await fsCore.promises.readFile(this.configPath, 'utf8');
        const configData = JSON.parse(configContent);
        const validatedConfig = this.validateAndMergeConfig(configData);
        this.updateConfig(validatedConfig, 'RELOAD', '配置文件重新加载');
      }
      
      // 加载配置文件
      await this.loadProfiles();
      
      // Configuration loaded successfully
    } catch (error) {
      logger.error('Configuration loading failed:', ErrorHandler.formatError(error));
      throw ErrorHandler.createError(
        CacheErrorCode.CONFIGURATION_ERROR,
        '配置加载失败',
        { configPath: this.configPath, error: ErrorHandler.formatError(error) }
      );
    }
  }
  
  /**
   * 加载配置文件
   */
  private async loadProfiles(): Promise<void> {
    try {
      if (await fs.pathExists(this.profilesPath)) {
        const profilesContent = await fsCore.promises.readFile(this.profilesPath, 'utf8');
        const profilesData = JSON.parse(profilesContent);
        if (Array.isArray(profilesData)) {
          for (const profileData of profilesData) {
            if (this.validateProfile(profileData)) {
              this.profiles.set(profileData.name, profileData);
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Configuration profiles loading failed:', ErrorHandler.formatError(error));
    }
  }
  
  /**
   * 保存配置
   */
  async saveConfiguration(): Promise<void> {
    try {
      await fs.writeJson(this.configPath, this.currentConfig, { spaces: 2 });
      
      // 保存配置文件
      const profilesArray = Array.from(this.profiles.values());
      await fs.writeJson(this.profilesPath, profilesArray, { spaces: 2 });
      
      // Configuration saved successfully
    } catch (error) {
      throw ErrorHandler.createError(
        CacheErrorCode.FILE_SYSTEM_ERROR,
        '配置保存失败',
        { configPath: this.configPath, error: ErrorHandler.formatError(error) }
      );
    }
  }
  
  /**
   * 验证并合并配置
   */
  private validateAndMergeConfig(newConfig: Partial<CacheConfig>): CacheConfig {
    const mergedConfig = { ...this.baseConfig, ...newConfig };
    
    // 验证配置
    const errors: string[] = [];
    for (const rule of this.validationRules) {
      const value = (mergedConfig as any)[rule.field];
      
      if (rule.required && (value === undefined || value === null)) {
        errors.push(`必需字段 ${rule.field} 缺失`);
        continue;
      }
      
      if (value !== undefined && value !== null) {
        // 类型验证
        if (rule.type === 'number' && typeof value !== 'number') {
          errors.push(`字段 ${rule.field} 必须是数字类型`);
        } else if (rule.type === 'string' && typeof value !== 'string') {
          errors.push(`字段 ${rule.field} 必须是字符串类型`);
        } else if (rule.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`字段 ${rule.field} 必须是布尔类型`);
        }
        
        // 范围验证
        if (rule.type === 'number' && typeof value === 'number') {
          if (rule.min !== undefined && value < rule.min) {
            errors.push(`字段 ${rule.field} 值 ${value} 小于最小值 ${rule.min}`);
          }
          if (rule.max !== undefined && value > rule.max) {
            errors.push(`字段 ${rule.field} 值 ${value} 大于最大值 ${rule.max}`);
          }
        }
        
        // 模式验证
        if (rule.pattern && typeof value === 'string') {
          if (!rule.pattern.test(value)) {
            errors.push(`字段 ${rule.field} 值不符合模式要求`);
          }
        }
        
        // 自定义验证器
        if (rule.validator) {
          const result = rule.validator(value);
          if (typeof result === 'string') {
            errors.push(`字段 ${rule.field}: ${result}`);
          } else if (!result) {
            errors.push(`字段 ${rule.field} 验证失败`);
          }
        }
      }
    }
    
    if (errors.length > 0) {
      throw ErrorHandler.createError(
        CacheErrorCode.CONFIGURATION_ERROR,
        `配置验证失败: ${errors.join(', ')}`,
        { errors }
      );
    }
    
    return mergedConfig;
  }
  
  /**
   * 验证配置文件
   */
  private validateProfile(profile: any): boolean {
    return (
      typeof profile === 'object' &&
      typeof profile.name === 'string' &&
      typeof profile.description === 'string' &&
      typeof profile.config === 'object' &&
      typeof profile.conditions === 'object' &&
      typeof profile.priority === 'number'
    );
  }
  
  /**
   * 更新配置
   */
  updateConfig(
    newConfig: Partial<CacheConfig>,
    source: ConfigChangeEvent['source'] = 'USER',
    reason: string = '用户更新'
  ): void {
    const oldConfig = { ...this.currentConfig };
    const validatedConfig = this.validateAndMergeConfig(newConfig);
    
    // 计算变更
    const changes: ConfigChangeEvent['changes'] = [];
    for (const [key, newValue] of Object.entries(newConfig)) {
      const oldValue = (oldConfig as any)[key];
      if (oldValue !== newValue) {
        changes.push({
          field: key,
          oldValue,
          newValue,
          reason
        });
      }
    }
    
    if (changes.length === 0) {
      return; // 没有变更
    }
    
    this.currentConfig = validatedConfig;
    
    // 记录变更事件
    const changeEvent: ConfigChangeEvent = {
      timestamp: Date.now(),
      changes,
      source,
      profile: this.activeProfile
    };
    
    this.changeHistory.push(changeEvent);
    if (this.changeHistory.length > this.maxHistorySize) {
      this.changeHistory = this.changeHistory.slice(-this.maxHistorySize);
    }
    
    // 通知监听器
    for (const listener of this.changeListeners) {
      try {
        listener(this.currentConfig, changeEvent);
      } catch (error) {
        logger.error('Configuration change listener execution failed:', ErrorHandler.formatError(error));
      }
    }
    
    logger.info(`Configuration updated (${source}): ${changes.map(c => c.field).join(', ')}`);
  }
  
  /**
   * 应用配置文件
   */
  applyProfile(profileName: string, reason: string = '应用配置文件'): boolean {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      logger.warn(`Configuration profile does not exist: ${profileName}`);
      return false;
    }
    
    this.activeProfile = profileName;
    this.updateConfig(profile.config, 'PROFILE_SWITCH', `${reason} (${profileName})`);
    
    logger.info(`Applied configuration profile: ${profileName} - ${profile.description}`);
    return true;
  }
  
  /**
   * 自动选择最佳配置文件
   */
  autoSelectProfile(): boolean {
    const currentMetrics = globalMonitoring.getCurrentMetrics();
    if (!currentMetrics) {
      return false;
    }
    
    const candidates: Array<{ profile: ConfigProfile; score: number }> = [];
    
    for (const profile of this.profiles.values()) {
      let score = profile.priority;
      let conditionsMet = 0;
      let totalConditions = 0;
      
      // 检查条件匹配
      for (const [metric, condition] of Object.entries(profile.conditions)) {
        totalConditions++;
        let value: number;
        
        switch (metric) {
          case 'memoryUsage':
            value = currentMetrics.cacheMetrics.memoryUtilization;
            break;
          case 'hitRate':
            value = currentMetrics.cacheMetrics.hitRate;
            break;
          case 'errorRate':
            value = currentMetrics.performanceMetrics.errorRate;
            break;
          case 'throughput':
            value = currentMetrics.performanceMetrics.throughputPerSecond;
            break;
          default:
            continue;
        }
        
        if (this.evaluateCondition(value, condition)) {
          conditionsMet++;
          score += 10; // 条件匹配加分
        }
      }
      
      // 条件匹配率加分
      if (totalConditions > 0) {
        score += (conditionsMet / totalConditions) * 20;
      }
      
      candidates.push({ profile, score });
    }
    
    // 选择得分最高的配置文件
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length > 0) {
      const bestProfile = candidates[0].profile;
      
      // 避免频繁切换相同配置文件
      if (this.activeProfile !== bestProfile.name) {
        return this.applyProfile(bestProfile.name, '自动选择最佳配置文件');
      }
    }
    
    return false;
  }
  
  /**
   * 评估条件
   */
  private evaluateCondition(
    value: number,
    condition: { operator: '>' | '<' | '>=' | '<=' | '=='; threshold: number }
  ): boolean {
    switch (condition.operator) {
      case '>': return value > condition.threshold;
      case '<': return value < condition.threshold;
      case '>=': return value >= condition.threshold;
      case '<=': return value <= condition.threshold;
      case '==': return value === condition.threshold;
      default: return false;
    }
  }
  
  /**
   * 开始自动调优
   */
  private startAutoTuning(): void {
    if (!this.autoTuneConfig.enabled) {
      return;
    }
    
    this.tuningTimer = setInterval(() => {
      this.performAutoTuning();
    }, this.autoTuneConfig.checkInterval);
    
    // Auto-tuning started
  }
  
  /**
   * 执行自动调优
   */
  private performAutoTuning(): void {
    try {
      // 收集当前性能指标
      const currentMetrics = globalMonitoring.getCurrentMetrics();
      if (!currentMetrics) return;
      
      const performanceMetrics: PerformanceMetrics = {
        hitRate: currentMetrics.cacheMetrics.hitRate,
        memoryUtilization: currentMetrics.cacheMetrics.memoryUtilization,
        averageResponseTime: currentMetrics.cacheMetrics.averageResponseTime,
        throughput: currentMetrics.performanceMetrics.throughputPerSecond,
        errorRate: currentMetrics.performanceMetrics.errorRate,
        gcFrequency: currentMetrics.cacheMetrics.gcExecutions
      };
      
      this.performanceHistory.push(performanceMetrics);
      if (this.performanceHistory.length > this.maxPerformanceHistory) {
        this.performanceHistory = this.performanceHistory.slice(-this.maxPerformanceHistory);
      }
      
      // 需要足够的样本进行分析
      if (this.performanceHistory.length < this.autoTuneConfig.minSampleSize) {
        return;
      }
      
      // 分析趋势并调整参数
      const adjustments = this.calculateOptimalAdjustments();
      if (Object.keys(adjustments).length > 0) {
        this.updateConfig(adjustments, 'AUTO_TUNE', '自动性能调优');
      }
      
      // 定期检查是否需要切换配置文件
      if (Math.random() < 0.1) { // 10%的概率检查配置文件
        this.autoSelectProfile();
      }
    } catch (error) {
      logger.error('Auto-tuning execution failed:', ErrorHandler.formatError(error));
    }
  }
  
  /**
   * 计算最优调整参数
   */
  private calculateOptimalAdjustments(): Partial<CacheConfig> {
    const adjustments: Partial<CacheConfig> = {};
    const recentMetrics = this.performanceHistory.slice(-5); // 最近5个样本
    
    if (recentMetrics.length < 3) return adjustments;
    
    // 计算平均值和趋势
    const avgHitRate = recentMetrics.reduce((sum, m) => sum + m.hitRate, 0) / recentMetrics.length;
    const avgMemoryUtil = recentMetrics.reduce((sum, m) => sum + m.memoryUtilization, 0) / recentMetrics.length;
    const avgResponseTime = recentMetrics.reduce((sum, m) => sum + m.averageResponseTime, 0) / recentMetrics.length;
    const avgThroughput = recentMetrics.reduce((sum, m) => sum + m.throughput, 0) / recentMetrics.length;
    
    // 调整maxEntries
    if (this.autoTuneConfig.enabledParameters.includes('maxEntries')) {
      if (avgHitRate < 70 && avgMemoryUtil < 80) {
        // 命中率低且内存充足，增加条目数
        const currentEntries = this.currentConfig.maxEntries || 1000;
        adjustments.maxEntries = Math.min(currentEntries * 1.2, 10000);
      } else if (avgMemoryUtil > 90) {
        // 内存使用率过高，减少条目数
        const currentEntries = this.currentConfig.maxEntries || 1000;
        adjustments.maxEntries = Math.max(currentEntries * 0.8, 100);
      }
    }
    
    // 调整defaultTTL
    if (this.autoTuneConfig.enabledParameters.includes('defaultTTL')) {
      if (avgHitRate > 90 && avgThroughput < 50) {
        // 命中率高但吞吐量低，可能TTL过长
        const currentTTL = this.currentConfig.defaultTTL || 3600000;
        adjustments.defaultTTL = Math.max(currentTTL * 0.9, 300000); // 最少5分钟
      } else if (avgHitRate < 60) {
        // 命中率低，增加TTL
        const currentTTL = this.currentConfig.defaultTTL || 3600000;
        adjustments.defaultTTL = Math.min(currentTTL * 1.1, 7200000); // 最多2小时
      }
    }
    
    // 调整checkInterval
    if (this.autoTuneConfig.enabledParameters.includes('checkInterval')) {
      if (avgMemoryUtil > 85) {
        // 内存压力大，增加清理频率
        const currentInterval = this.currentConfig.checkInterval || 60000;
        adjustments.checkInterval = Math.max(currentInterval * 0.8, 15000);
      } else if (avgMemoryUtil < 50) {
        // 内存充足，减少清理频率
        const currentInterval = this.currentConfig.checkInterval || 60000;
        adjustments.checkInterval = Math.min(currentInterval * 1.2, 300000);
      }
    }
    
    return adjustments;
  }
  
  // ==== 公共API方法 ====
  
  /**
   * 获取当前配置
   */
  getConfig(): CacheConfig {
    return { ...this.currentConfig };
  }
  
  /**
   * 获取配置文件列表
   */
  getProfiles(): ConfigProfile[] {
    return Array.from(this.profiles.values());
  }
  
  /**
   * 获取活跃配置文件
   */
  getActiveProfile(): string | undefined {
    return this.activeProfile;
  }
  
  /**
   * 添加配置文件
   */
  addProfile(profile: ConfigProfile): void {
    if (this.validateProfile(profile)) {
      this.profiles.set(profile.name, profile);
      logger.info(`Added configuration profile: ${profile.name}`);
    } else {
      throw ErrorHandler.createError(
        CacheErrorCode.INVALID_INPUT,
        '配置文件格式无效',
        { profile }
      );
    }
  }
  
  /**
   * 删除配置文件
   */
  removeProfile(profileName: string): boolean {
    if (this.activeProfile === profileName) {
      logger.warn(`Cannot delete currently active configuration profile: ${profileName}`);
      return false;
    }
    
    return this.profiles.delete(profileName);
  }
  
  /**
   * 获取配置变更历史
   */
  getChangeHistory(limit?: number): ConfigChangeEvent[] {
    if (limit) {
      return this.changeHistory.slice(-limit);
    }
    return [...this.changeHistory];
  }
  
  /**
   * 获取自动调优配置
   */
  getAutoTuneConfig(): AutoTuneConfig {
    return { ...this.autoTuneConfig };
  }
  
  /**
   * 更新自动调优配置
   */
  updateAutoTuneConfig(config: Partial<AutoTuneConfig>): void {
    const oldEnabled = this.autoTuneConfig.enabled;
    this.autoTuneConfig = { ...this.autoTuneConfig, ...config };
    
    // 重启自动调优
    if (this.tuningTimer) {
      clearInterval(this.tuningTimer);
    }
    
    if (this.autoTuneConfig.enabled) {
      this.startAutoTuning();
    }
    
    // Auto-tuning configuration updated
  }
  
  /**
   * 获取性能历史
   */
  getPerformanceHistory(limit?: number): PerformanceMetrics[] {
    if (limit) {
      return this.performanceHistory.slice(-limit);
    }
    return [...this.performanceHistory];
  }
  
  /**
   * 添加配置变更监听器
   */
  addChangeListener(listener: (config: CacheConfig, changes: ConfigChangeEvent) => void): void {
    this.changeListeners.push(listener);
  }
  
  /**
   * 移除配置变更监听器
   */
  removeChangeListener(listener: (config: CacheConfig, changes: ConfigChangeEvent) => void): void {
    const index = this.changeListeners.indexOf(listener);
    if (index > -1) {
      this.changeListeners.splice(index, 1);
    }
  }
  
  /**
   * 重置配置到默认值
   */
  resetToDefaults(): void {
    this.updateConfig(this.baseConfig, 'USER', '重置为默认配置');
    this.activeProfile = undefined;
  }
  
  /**
   * 导出配置
   */
  exportConfig(): {
    config: CacheConfig;
    profiles: ConfigProfile[];
    autoTuneConfig: AutoTuneConfig;
    changeHistory: ConfigChangeEvent[];
  } {
    return {
      config: this.getConfig(),
      profiles: this.getProfiles(),
      autoTuneConfig: this.getAutoTuneConfig(),
      changeHistory: this.getChangeHistory()
    };
  }
  
  /**
   * 导入配置
   */
  importConfig(data: {
    config?: CacheConfig;
    profiles?: ConfigProfile[];
    autoTuneConfig?: AutoTuneConfig;
  }): void {
    if (data.config) {
      this.updateConfig(data.config, 'USER', '导入配置');
    }
    
    if (data.profiles) {
      for (const profile of data.profiles) {
        this.addProfile(profile);
      }
    }
    
    if (data.autoTuneConfig) {
      this.updateAutoTuneConfig(data.autoTuneConfig);
    }
    
    // Configuration import completed
  }
  
  /**
   * 获取配置建议
   */
  getConfigurationRecommendations(): Array<{
    category: string;
    recommendation: string;
    impact: 'LOW' | 'MEDIUM' | 'HIGH';
    suggestedConfig: Partial<CacheConfig>;
  }> {
    const recommendations: Array<{
      category: string;
      recommendation: string;
      impact: 'LOW' | 'MEDIUM' | 'HIGH';
      suggestedConfig: Partial<CacheConfig>;
    }> = [];
    
    const currentMetrics = globalMonitoring.getCurrentMetrics();
    if (!currentMetrics) {
      return recommendations;
    }
    
    // 基于当前性能指标提供建议
    if (currentMetrics.cacheMetrics.hitRate < 60) {
      recommendations.push({
        category: '性能优化',
        recommendation: '缓存命中率低，建议增加缓存容量或延长TTL',
        impact: 'HIGH',
        suggestedConfig: {
          maxEntries: (this.currentConfig.maxEntries || 1000) * 1.5,
          defaultTTL: (this.currentConfig.defaultTTL || 3600000) * 1.2
        }
      });
    }
    
    if (currentMetrics.cacheMetrics.memoryUtilization > 90) {
      recommendations.push({
        category: '内存管理',
        recommendation: '内存使用率过高，建议启用精确内存计算或减少缓存容量',
        impact: 'HIGH',
        suggestedConfig: {
          preciseMemoryCalculation: true,
          maxEntries: (this.currentConfig.maxEntries || 1000) * 0.8
        }
      });
    }
    
    if (currentMetrics.performanceMetrics.p95ResponseTime > 500) {
      recommendations.push({
        category: '响应时间',
        recommendation: '响应时间过长，建议优化清理间隔',
        impact: 'MEDIUM',
        suggestedConfig: {
          checkInterval: Math.max((this.currentConfig.checkInterval || 60000) * 0.8, 15000)
        }
      });
    }
    
    return recommendations;
  }
  
  /**
   * 停止配置管理器
   */
  stop(): void {
    if (this.tuningTimer) {
      clearInterval(this.tuningTimer);
      this.tuningTimer = undefined;
    }
    // Configuration manager stopped
  }
}

/**
 * 全局配置管理器实例
 */
export const globalConfigManager = ConfigManager.getInstance();