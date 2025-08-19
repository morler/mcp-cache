/**
 * 监控和统计模块
 * 提供全面的系统监控、性能分析和告警功能
 */

import { logger } from './logger.js';

export interface MonitoringMetrics {
  timestamp: number;
  cacheMetrics: {
    hitRate: number;
    missRate: number;
    totalRequests: number;
    averageResponseTime: number;
    memoryUsage: number;
    memoryUtilization: number;
    entryCount: number;
    evictionCount: number;
    gcExecutions: number;
  };
  performanceMetrics: {
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    throughputPerSecond: number;
    errorRate: number;
    concurrentOperations: number;
  };
  systemMetrics: {
    cpuUsage: number;
    memoryPressure: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    diskUsage: number;
    networkLatency: number;
    uptime: number;
  };
  errorMetrics: {
    totalErrors: number;
    errorsByType: Record<string, number>;
    criticalErrors: number;
    recoveredErrors: number;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  condition: {
    metric: string;
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    threshold: number;
  };
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  enabled: boolean;
  cooldownMs: number;
  lastTriggered?: number;
  description: string;
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
  metrics: Record<string, any>;
}

export interface PerformanceTrend {
  metric: string;
  timeWindow: number; // 时间窗口（毫秒）
  dataPoints: Array<{
    timestamp: number;
    value: number;
  }>;
  trend: 'IMPROVING' | 'STABLE' | 'DEGRADING';
  changeRate: number; // 变化率（百分比）
}

export interface DashboardData {
  overview: {
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    uptime: number;
    totalRequests: number;
    activeAlerts: number;
    performanceScore: number;
  };
  metrics: MonitoringMetrics;
  trends: PerformanceTrend[];
  recentAlerts: Alert[];
  topErrors: Array<{
    errorType: string;
    count: number;
    lastOccurrence: number;
  }>;
}

/**
 * 监控管理器
 */
export class MonitoringManager {
  private static instance: MonitoringManager;
  
  // 指标存储
  private metricsHistory: MonitoringMetrics[] = [];
  private maxHistorySize: number = 1000;
  
  // 告警管理
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  
  // 性能趋势分析
  private trendAnalysis: Map<string, PerformanceTrend> = new Map();
  private trendUpdateInterval: number = 60000; // 1分钟
  
  // 统计计数器
  private counters = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    gcExecutions: 0,
    evictions: 0
  };
  
  // 响应时间跟踪
  private responseTimes: number[] = [];
  private maxResponseTimeHistory: number = 1000;
  
  // 系统启动时间
  private startTime: number = Date.now();
  
  // 定时器
  private metricsCollectionTimer?: NodeJS.Timeout;
  private trendAnalysisTimer?: NodeJS.Timeout;
  private alertCheckTimer?: NodeJS.Timeout;
  
  private constructor() {
    this.initializeDefaultAlertRules();
    this.startPeriodicCollection();
  }
  
  static getInstance(): MonitoringManager {
    if (!MonitoringManager.instance) {
      MonitoringManager.instance = new MonitoringManager();
    }
    return MonitoringManager.instance;
  }
  
  /**
   * 初始化默认告警规则
   */
  private initializeDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high-error-rate',
        name: '高错误率告警',
        condition: { metric: 'errorRate', operator: '>', threshold: 5 },
        severity: 'HIGH',
        enabled: true,
        cooldownMs: 300000, // 5分钟
        description: '错误率超过5%时触发告警'
      },
      {
        id: 'low-hit-rate',
        name: '缓存命中率低',
        condition: { metric: 'hitRate', operator: '<', threshold: 80 },
        severity: 'MEDIUM',
        enabled: true,
        cooldownMs: 600000, // 10分钟
        description: '缓存命中率低于80%时触发告警'
      },
      {
        id: 'high-memory-usage',
        name: '内存使用率过高',
        condition: { metric: 'memoryUtilization', operator: '>', threshold: 90 },
        severity: 'CRITICAL',
        enabled: true,
        cooldownMs: 180000, // 3分钟
        description: '内存使用率超过90%时触发告警'
      },
      {
        id: 'slow-response-time',
        name: '响应时间过慢',
        condition: { metric: 'p95ResponseTime', operator: '>', threshold: 1000 },
        severity: 'HIGH',
        enabled: true,
        cooldownMs: 300000, // 5分钟
        description: 'P95响应时间超过1秒时触发告警'
      },
      {
        id: 'high-concurrent-operations',
        name: '并发操作过多',
        condition: { metric: 'concurrentOperations', operator: '>', threshold: 100 },
        severity: 'MEDIUM',
        enabled: true,
        cooldownMs: 240000, // 4分钟
        description: '并发操作数超过100时触发告警'
      }
    ];
    
    for (const rule of defaultRules) {
      this.alertRules.set(rule.id, rule);
    }
  }
  
  /**
   * 开始周期性数据收集
   */
  private startPeriodicCollection(): void {
    // 每30秒收集一次指标
    this.metricsCollectionTimer = setInterval(() => {
      this.collectMetrics();
    }, 30000);
    
    // 每分钟进行趋势分析
    this.trendAnalysisTimer = setInterval(() => {
      this.analyzeTrends();
    }, this.trendUpdateInterval);
    
    // 每15秒检查告警条件
    this.alertCheckTimer = setInterval(() => {
      this.checkAlerts();
    }, 15000);
  }
  
  /**
   * 收集当前指标
   */
  private collectMetrics(): void {
    const now = Date.now();
    const totalRequests = this.counters.totalRequests;
    const totalErrors = this.counters.failedRequests;
    const totalHits = this.counters.cacheHits;
    const totalMisses = this.counters.cacheMisses;
    
    const metrics: MonitoringMetrics = {
      timestamp: now,
      cacheMetrics: {
        hitRate: totalHits + totalMisses > 0 ? (totalHits / (totalHits + totalMisses)) * 100 : 0,
        missRate: totalHits + totalMisses > 0 ? (totalMisses / (totalHits + totalMisses)) * 100 : 0,
        totalRequests,
        averageResponseTime: this.calculateAverageResponseTime(),
        memoryUsage: process.memoryUsage().heapUsed,
        memoryUtilization: (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100,
        entryCount: 0, // 需要从CacheManager获取
        evictionCount: this.counters.evictions,
        gcExecutions: this.counters.gcExecutions
      },
      performanceMetrics: {
        p50ResponseTime: this.calculatePercentile(50),
        p95ResponseTime: this.calculatePercentile(95),
        p99ResponseTime: this.calculatePercentile(99),
        throughputPerSecond: this.calculateThroughput(),
        errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
        concurrentOperations: 0 // 需要从系统获取
      },
      systemMetrics: {
        cpuUsage: 0, // 需要从系统API获取
        memoryPressure: this.determineMemoryPressure(),
        diskUsage: 0, // 需要从系统API获取
        networkLatency: 0, // 需要从网络检查获取
        uptime: now - this.startTime
      },
      errorMetrics: {
        totalErrors,
        errorsByType: {}, // 需要从ErrorHandler获取
        criticalErrors: 0, // 需要从ErrorHandler获取
        recoveredErrors: 0 // 需要从ErrorHandler获取
      }
    };
    
    this.metricsHistory.push(metrics);
    
    // 限制历史记录大小
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
    }
  }
  
  /**
   * 分析性能趋势
   */
  private analyzeTrends(): void {
    if (this.metricsHistory.length < 2) return;
    
    const recentMetrics = this.metricsHistory.slice(-10); // 最近10个数据点
    const trendMetrics = [
      'cacheMetrics.hitRate',
      'performanceMetrics.p95ResponseTime',
      'performanceMetrics.throughputPerSecond',
      'performanceMetrics.errorRate',
      'systemMetrics.memoryPressure'
    ];
    
    for (const metricPath of trendMetrics) {
      const dataPoints = recentMetrics.map(m => ({
        timestamp: m.timestamp,
        value: this.getNestedValue(m, metricPath) as number
      })).filter(dp => typeof dp.value === 'number');
      
      if (dataPoints.length < 2) continue;
      
      const trend = this.calculateTrend(dataPoints);
      this.trendAnalysis.set(metricPath, {
        metric: metricPath,
        timeWindow: this.trendUpdateInterval * 10,
        dataPoints,
        trend: trend.direction,
        changeRate: trend.rate
      });
    }
  }
  
  /**
   * 检查告警条件
   */
  private checkAlerts(): void {
    if (this.metricsHistory.length === 0) return;
    
    const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];
    const now = Date.now();
    
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;
      
      // 检查冷却时间
      if (rule.lastTriggered && now - rule.lastTriggered < rule.cooldownMs) {
        continue;
      }
      
      const metricValue = this.getNestedValue(latestMetrics, rule.condition.metric) as number;
      if (typeof metricValue !== 'number') continue;
      
      const conditionMet = this.evaluateCondition(metricValue, rule.condition);
      
      if (conditionMet) {
        this.triggerAlert(rule, latestMetrics, metricValue);
      }
    }
  }
  
  /**
   * 触发告警
   */
  private triggerAlert(rule: AlertRule, metrics: MonitoringMetrics, metricValue: number): void {
    const alert: Alert = {
      id: `alert_${rule.id}_${Date.now()}`,
      ruleId: rule.id,
      severity: rule.severity,
      message: `${rule.name}: ${rule.condition.metric} = ${metricValue} ${rule.condition.operator} ${rule.condition.threshold}`,
      timestamp: Date.now(),
      resolved: false,
      metrics: { [rule.condition.metric]: metricValue }
    };
    
    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);
    rule.lastTriggered = Date.now();
    
    logger.warn(`[Monitoring Alert] ${alert.severity}: ${alert.message}`);
    
    // 可以在这里添加通知逻辑（邮件、Webhook等）
  }
  
  // ==== 公共API方法 ====
  
  /**
   * 记录请求
   */
  recordRequest(success: boolean, responseTime: number): void {
    this.counters.totalRequests++;
    if (success) {
      this.counters.successfulRequests++;
    } else {
      this.counters.failedRequests++;
    }
    
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes = this.responseTimes.slice(-this.maxResponseTimeHistory);
    }
  }
  
  /**
   * 记录缓存操作
   */
  recordCacheOperation(type: 'hit' | 'miss'): void {
    if (type === 'hit') {
      this.counters.cacheHits++;
    } else {
      this.counters.cacheMisses++;
    }
  }
  
  /**
   * 记录GC执行
   */
  recordGCExecution(): void {
    this.counters.gcExecutions++;
  }
  
  /**
   * 记录条目驱逐
   */
  recordEviction(): void {
    this.counters.evictions++;
  }
  
  /**
   * 获取实时指标
   */
  getCurrentMetrics(): MonitoringMetrics | null {
    return this.metricsHistory.length > 0 ? this.metricsHistory[this.metricsHistory.length - 1] : null;
  }
  
  /**
   * 获取历史指标
   */
  getMetricsHistory(limit?: number): MonitoringMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit);
    }
    return [...this.metricsHistory];
  }
  
  /**
   * 获取性能趋势
   */
  getPerformanceTrends(): PerformanceTrend[] {
    return Array.from(this.trendAnalysis.values());
  }
  
  /**
   * 获取活跃告警
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
  }
  
  /**
   * 获取告警历史
   */
  getAlertHistory(limit?: number): Alert[] {
    if (limit) {
      return this.alertHistory.slice(-limit);
    }
    return [...this.alertHistory];
  }
  
  /**
   * 获取仪表板数据
   */
  getDashboardData(): DashboardData {
    const currentMetrics = this.getCurrentMetrics();
    const activeAlerts = this.getActiveAlerts();
    const recentAlerts = this.getAlertHistory(10);
    
    const status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 
      activeAlerts.some(a => a.severity === 'CRITICAL') ? 'CRITICAL' :
      activeAlerts.some(a => a.severity === 'HIGH') ? 'WARNING' : 'HEALTHY';
    
    const performanceScore = this.calculatePerformanceScore(currentMetrics);
    
    return {
      overview: {
        status,
        uptime: Date.now() - this.startTime,
        totalRequests: this.counters.totalRequests,
        activeAlerts: activeAlerts.length,
        performanceScore
      },
      metrics: currentMetrics || {} as MonitoringMetrics,
      trends: this.getPerformanceTrends(),
      recentAlerts,
      topErrors: this.getTopErrors()
    };
  }
  
  /**
   * 添加告警规则
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
  }
  
  /**
   * 删除告警规则
   */
  removeAlertRule(ruleId: string): boolean {
    return this.alertRules.delete(ruleId);
  }
  
  /**
   * 获取所有告警规则
   */
  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }
  
  /**
   * 解决告警
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      return true;
    }
    return false;
  }
  
  /**
   * 获取系统健康状态
   */
  getSystemHealth(): {
    overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    score: number;
    details: Record<string, any>;
  } {
    const currentMetrics = this.getCurrentMetrics();
    const activeAlerts = this.getActiveAlerts();
    
    if (!currentMetrics) {
      return {
        overall: 'UNHEALTHY',
        score: 0,
        details: { reason: 'No metrics available' }
      };
    }
    
    const score = this.calculatePerformanceScore(currentMetrics);
    const criticalAlerts = activeAlerts.filter(a => a.severity === 'CRITICAL').length;
    const highAlerts = activeAlerts.filter(a => a.severity === 'HIGH').length;
    
    let overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    if (criticalAlerts > 0 || score < 60) {
      overall = 'UNHEALTHY';
    } else if (highAlerts > 0 || score < 80) {
      overall = 'DEGRADED';
    } else {
      overall = 'HEALTHY';
    }
    
    return {
      overall,
      score,
      details: {
        criticalAlerts,
        highAlerts,
        errorRate: currentMetrics.performanceMetrics.errorRate,
        hitRate: currentMetrics.cacheMetrics.hitRate,
        memoryUtilization: currentMetrics.cacheMetrics.memoryUtilization,
        responseTime: currentMetrics.performanceMetrics.p95ResponseTime
      }
    };
  }
  
  // ==== 辅助方法 ====
  
  private calculateAverageResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;
    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    return sum / this.responseTimes.length;
  }
  
  private calculatePercentile(percentile: number): number {
    if (this.responseTimes.length === 0) return 0;
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
  
  private calculateThroughput(): number {
    // 计算最近1分钟的吞吐量
    const oneMinuteAgo = Date.now() - 60000;
    const recentMetrics = this.metricsHistory.filter(m => m.timestamp > oneMinuteAgo);
    
    if (recentMetrics.length < 2) return 0;
    
    const oldestMetric = recentMetrics[0];
    const latestMetric = recentMetrics[recentMetrics.length - 1];
    const timeDiff = (latestMetric.timestamp - oldestMetric.timestamp) / 1000; // 转换为秒
    const requestDiff = latestMetric.cacheMetrics.totalRequests - oldestMetric.cacheMetrics.totalRequests;
    
    return timeDiff > 0 ? requestDiff / timeDiff : 0;
  }
  
  private determineMemoryPressure(): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const memUsage = process.memoryUsage();
    const utilization = memUsage.heapUsed / memUsage.heapTotal;
    
    if (utilization > 0.95) return 'CRITICAL';
    if (utilization > 0.85) return 'HIGH';
    if (utilization > 0.7) return 'MEDIUM';
    return 'LOW';
  }
  
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
  
  private evaluateCondition(value: number, condition: AlertRule['condition']): boolean {
    switch (condition.operator) {
      case '>': return value > condition.threshold;
      case '<': return value < condition.threshold;
      case '>=': return value >= condition.threshold;
      case '<=': return value <= condition.threshold;
      case '==': return value === condition.threshold;
      case '!=': return value !== condition.threshold;
      default: return false;
    }
  }
  
  private calculateTrend(dataPoints: Array<{ timestamp: number; value: number }>): {
    direction: 'IMPROVING' | 'STABLE' | 'DEGRADING';
    rate: number;
  } {
    if (dataPoints.length < 2) {
      return { direction: 'STABLE', rate: 0 };
    }
    
    const firstValue = dataPoints[0].value;
    const lastValue = dataPoints[dataPoints.length - 1].value;
    const changeRate = ((lastValue - firstValue) / firstValue) * 100;
    
    let direction: 'IMPROVING' | 'STABLE' | 'DEGRADING';
    if (Math.abs(changeRate) < 5) {
      direction = 'STABLE';
    } else if (changeRate > 0) {
      // 对于错误率等，增长是负面的；对于命中率等，增长是正面的
      // 这里简化处理，实际应该根据指标类型判断
      direction = 'IMPROVING';
    } else {
      direction = 'DEGRADING';
    }
    
    return { direction, rate: Math.abs(changeRate) };
  }
  
  private calculatePerformanceScore(metrics: MonitoringMetrics | null): number {
    if (!metrics) return 0;
    
    let score = 100;
    
    // 命中率影响 (30分)
    const hitRateScore = Math.min(metrics.cacheMetrics.hitRate / 90 * 30, 30);
    score = score - 30 + hitRateScore;
    
    // 错误率影响 (25分)
    const errorRatePenalty = Math.min(metrics.performanceMetrics.errorRate * 5, 25);
    score -= errorRatePenalty;
    
    // 响应时间影响 (25分)
    const responseTimePenalty = Math.min(metrics.performanceMetrics.p95ResponseTime / 100, 25);
    score -= responseTimePenalty;
    
    // 内存使用率影响 (20分)
    const memoryPenalty = Math.max(0, (metrics.cacheMetrics.memoryUtilization - 80) / 20 * 20);
    score -= memoryPenalty;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private getTopErrors(): Array<{ errorType: string; count: number; lastOccurrence: number }> {
    // 这里需要从ErrorHandler获取错误统计
    // 暂时返回模拟数据
    return [
      { errorType: 'TIMEOUT_ERROR', count: 5, lastOccurrence: Date.now() - 300000 },
      { errorType: 'MEMORY_LIMIT_EXCEEDED', count: 3, lastOccurrence: Date.now() - 600000 },
      { errorType: 'NETWORK_ERROR', count: 2, lastOccurrence: Date.now() - 900000 }
    ];
  }
  
  /**
   * 停止监控
   */
  stop(): void {
    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
    }
    if (this.trendAnalysisTimer) {
      clearInterval(this.trendAnalysisTimer);
    }
    if (this.alertCheckTimer) {
      clearInterval(this.alertCheckTimer);
    }
  }
  
  /**
   * 重置所有统计
   */
  reset(): void {
    this.metricsHistory = [];
    this.activeAlerts.clear();
    this.alertHistory = [];
    this.trendAnalysis.clear();
    this.responseTimes = [];
    this.counters = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      gcExecutions: 0,
      evictions: 0
    };
    this.startTime = Date.now();
  }
}

/**
 * 全局监控实例
 */
export const globalMonitoring = MonitoringManager.getInstance();

/**
 * 监控装饰器：用于自动记录方法执行时间和成功/失败状态
 */
export function monitored(target: any, propertyName: string, descriptor: PropertyDescriptor) {
  const method = descriptor.value;
  
  descriptor.value = async function (...args: any[]) {
    const startTime = Date.now();
    let success = false;
    
    try {
      const result = await method.apply(this, args);
      success = true;
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const responseTime = Date.now() - startTime;
      globalMonitoring.recordRequest(success, responseTime);
    }
  };
  
  return descriptor;
}

/**
 * 性能分析器：用于详细的性能分析
 */
export class PerformanceProfiler {
  private profiles: Map<string, {
    calls: number;
    totalTime: number;
    minTime: number;
    maxTime: number;
    avgTime: number;
    lastCalled: number;
  }> = new Map();
  
  /**
   * 开始性能分析
   */
  startProfile(name: string): () => void {
    const startTime = Date.now();
    
    return () => {
      const duration = Date.now() - startTime;
      this.recordProfile(name, duration);
    };
  }
  
  /**
   * 记录性能数据
   */
  private recordProfile(name: string, duration: number): void {
    const existing = this.profiles.get(name);
    
    if (existing) {
      existing.calls++;
      existing.totalTime += duration;
      existing.minTime = Math.min(existing.minTime, duration);
      existing.maxTime = Math.max(existing.maxTime, duration);
      existing.avgTime = existing.totalTime / existing.calls;
      existing.lastCalled = Date.now();
    } else {
      this.profiles.set(name, {
        calls: 1,
        totalTime: duration,
        minTime: duration,
        maxTime: duration,
        avgTime: duration,
        lastCalled: Date.now()
      });
    }
  }
  
  /**
   * 获取性能报告
   */
  getReport(): Record<string, any> {
    const report: Record<string, any> = {};
    
    for (const [name, data] of this.profiles.entries()) {
      report[name] = {
        ...data,
        callsPerMinute: this.calculateCallsPerMinute(data.lastCalled, data.calls)
      };
    }
    
    return report;
  }
  
  private calculateCallsPerMinute(lastCalled: number, totalCalls: number): number {
    const minutesAgo = (Date.now() - lastCalled) / 60000;
    return minutesAgo > 0 ? totalCalls / minutesAgo : 0;
  }
  
  /**
   * 清除性能数据
   */
  clear(): void {
    this.profiles.clear();
  }
}

/**
 * 全局性能分析器
 */
export const globalProfiler = new PerformanceProfiler();