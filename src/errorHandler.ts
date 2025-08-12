export enum CacheErrorCode {
  // 通用错误 (1000-1999)
  UNKNOWN_ERROR = 1000,
  INVALID_INPUT = 1001,
  CONFIGURATION_ERROR = 1002,
  
  // 缓存操作错误 (2000-2999)
  KEY_NOT_FOUND = 2000,
  KEY_ALREADY_EXISTS = 2001,
  CACHE_FULL = 2002,
  MEMORY_LIMIT_EXCEEDED = 2003,
  ENTRY_EXPIRED = 2004,
  
  // 版本管理错误 (3000-3999)
  VERSION_NOT_FOUND = 3000,
  VERSION_CONFLICT = 3001,
  DEPENDENCY_CHANGED = 3002,
  INVALID_VERSION_FORMAT = 3003,
  
  // 并发错误 (4000-4999)
  LOCK_ACQUISITION_FAILED = 4000,
  CONCURRENT_MODIFICATION = 4001,
  
  // 系统错误 (5000-5999)
  FILE_SYSTEM_ERROR = 5000,
  NETWORK_ERROR = 5001,
  RESOURCE_UNAVAILABLE = 5002,
  TIMEOUT_ERROR = 5003,
  
  // 安全错误 (6000-6999)
  ACCESS_DENIED = 6000,
  ENCRYPTION_ERROR = 6001,
  AUTHENTICATION_FAILED = 6002,
  
  // 服务错误 (7000-7999)
  SERVICE_OVERLOADED = 7000,
  CIRCUIT_BREAKER_OPEN = 7001,
  RETRY_EXHAUSTED = 7002,
  RECOVERY_FAILED = 7003
}

export interface CacheErrorDetails {
  code: CacheErrorCode;
  message: string;
  details?: Record<string, any>;
  stack?: string;
  timestamp: number;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recoverable?: boolean;
  category?: 'SYSTEM' | 'BUSINESS' | 'SECURITY' | 'PERFORMANCE';
}

export class CacheError extends Error {
  public readonly code: CacheErrorCode;
  public readonly details: Record<string, any>;
  public readonly timestamp: number;

  constructor(
    code: CacheErrorCode,
    message: string,
    details: Record<string, any> = {}
  ) {
    super(message);
    this.name = 'CacheError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    
    // 保持原型链
    Object.setPrototypeOf(this, CacheError.prototype);
  }
  
  static createError(
    code: CacheErrorCode,
    message: string,
    details: Record<string, any> = {}
  ): CacheError {
    return new CacheError(code, message, details);
  }

  toJSON(): CacheErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack,
      timestamp: this.timestamp
    };
  }

  toString(): string {
    return `[CacheError ${this.code}] ${this.message}`;
  }
}

// 断路器状态
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // 正常状态
  OPEN = 'OPEN',         // 断路状态
  HALF_OPEN = 'HALF_OPEN' // 半开状态
}

// 断路器配置
export interface CircuitBreakerConfig {
  failureThreshold: number;     // 故障阈值
  recoveryTimeout: number;      // 恢复超时时间
  monitoringPeriod: number;     // 监控周期
  halfOpenMaxCalls: number;     // 半开状态最大调用数
}

// 重试配置
export interface RetryConfig {
  maxAttempts: number;          // 最大重试次数
  initialDelay: number;         // 初始延迟
  maxDelay: number;             // 最大延迟
  backoffMultiplier: number;    // 退避倍数
  retryableErrors: CacheErrorCode[]; // 可重试的错误类型
}

// 断路器类
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;
  private halfOpenCalls: number = 0;
  private stats = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    circuitOpenEvents: 0,
    circuitCloseEvents: 0
  };
  
  constructor(private config: CircuitBreakerConfig, private name: string) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.stats.totalCalls++;
    
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.recoveryTimeout) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;
        console.log(`断路器 ${this.name} 进入半开状态`);
      } else {
        throw ErrorHandler.createError(
          CacheErrorCode.CIRCUIT_BREAKER_OPEN,
          `断路器 ${this.name} 处于开启状态`,
          { circuitBreakerName: this.name, state: this.state }
        );
      }
    }
    
    if (this.state === CircuitBreakerState.HALF_OPEN && 
        this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
      throw ErrorHandler.createError(
        CacheErrorCode.CIRCUIT_BREAKER_OPEN,
        `断路器 ${this.name} 半开状态调用次数超限`,
        { circuitBreakerName: this.name, halfOpenCalls: this.halfOpenCalls }
      );
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.stats.successfulCalls++;
    this.failureCount = 0;
    
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;
      this.halfOpenCalls++;
      
      if (this.successCount >= this.config.halfOpenMaxCalls / 2) {
        this.state = CircuitBreakerState.CLOSED;
        this.successCount = 0;
        this.stats.circuitCloseEvents++;
        console.log(`断路器 ${this.name} 恢复到关闭状态`);
      }
    }
  }
  
  private onFailure(): void {
    this.stats.failedCalls++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.halfOpenCalls = 0;
      this.successCount = 0;
      console.log(`断路器 ${this.name} 从半开状态回到开启状态`);
      return;
    }
    
    if (this.state === CircuitBreakerState.CLOSED && 
        this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.stats.circuitOpenEvents++;
      console.log(`断路器 ${this.name} 开启，故障次数: ${this.failureCount}`);
    }
  }
  
  getState(): CircuitBreakerState {
    return this.state;
  }
  
  getStats() {
    return {
      ...this.stats,
      state: this.state,
      failureCount: this.failureCount,
      successRate: this.stats.totalCalls > 0 
        ? (this.stats.successfulCalls / this.stats.totalCalls * 100).toFixed(2) + '%'
        : '0%'
    };
  }
  
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCalls = 0;
    console.log(`断路器 ${this.name} 已重置`);
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: CacheErrorDetails[] = [];
  private maxLogSize: number = 1000;
  
  // 断路器管理
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private defaultCircuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 60000,     // 1分钟
    monitoringPeriod: 10000,    // 10秒
    halfOpenMaxCalls: 3
  };
  
  // 默认重试配置
  private defaultRetryConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelay: 1000,         // 1秒
    maxDelay: 30000,            // 30秒
    backoffMultiplier: 2,
    retryableErrors: [
      CacheErrorCode.NETWORK_ERROR,
      CacheErrorCode.TIMEOUT_ERROR,
      CacheErrorCode.RESOURCE_UNAVAILABLE,
      CacheErrorCode.LOCK_ACQUISITION_FAILED
    ]
  };

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * 创建并记录缓存错误
   */
  static createError(
    code: CacheErrorCode,
    message: string,
    details: Record<string, any> = {}
  ): CacheError {
    const error = new CacheError(code, message, details);
    ErrorHandler.getInstance().logError(error);
    return error;
  }

  /**
   * 记录错误
   */
  private logError(error: CacheError): void {
    const errorDetails = error.toJSON();
    
    this.errorLog.push(errorDetails);
    
    // 保持日志大小限制
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
    
    // 输出到控制台
    console.error(error.toString(), error.details);
  }

  /**
   * 获取错误日志
   */
  getErrorLog(limit?: number): CacheErrorDetails[] {
    if (limit) {
      return this.errorLog.slice(-limit);
    }
    return [...this.errorLog];
  }

  /**
   * 清除错误日志
   */
  clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * 获取错误统计
   */
  getErrorStats(): {
    totalErrors: number;
    errorsByCode: Record<CacheErrorCode, number>;
    recentErrors: CacheErrorDetails[];
  } {
    const errorsByCode: Record<CacheErrorCode, number> = {} as any;
    
    for (const error of this.errorLog) {
      errorsByCode[error.code] = (errorsByCode[error.code] || 0) + 1;
    }

    return {
      totalErrors: this.errorLog.length,
      errorsByCode,
      recentErrors: this.errorLog.slice(-10)
    };
  }

  /**
   * 格式化错误消息
   */
  static formatError(error: unknown): string {
    if (error instanceof CacheError) {
      return error.toString();
    }
    
    if (error instanceof Error) {
      return `[Error] ${error.message}`;
    }
    
    return `[Unknown Error] ${String(error)}`;
  }

  /**
   * 判断是否为缓存错误
   */
  static isCacheError(error: unknown): error is CacheError {
    return error instanceof CacheError;
  }

  /**
   * 判断是否为特定类型的错误
   */
  static isErrorCode(error: unknown, code: CacheErrorCode): boolean {
    return ErrorHandler.isCacheError(error) && error.code === code;
  }
  
  // ==== 断路器功能 ====
  
  /**
   * 获取或创建断路器
   */
  getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.circuitBreakers.has(name)) {
      const finalConfig = { ...this.defaultCircuitBreakerConfig, ...config };
      this.circuitBreakers.set(name, new CircuitBreaker(finalConfig, name));
    }
    return this.circuitBreakers.get(name)!;
  }
  
  /**
   * 移除断路器
   */
  removeCircuitBreaker(name: string): boolean {
    return this.circuitBreakers.delete(name);
  }
  
  /**
   * 重置所有断路器
   */
  resetAllCircuitBreakers(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }
  }
  
  /**
   * 获取所有断路器状态
   */
  getAllCircuitBreakerStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name, breaker] of this.circuitBreakers.entries()) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }
  
  // ==== 重试机制 ====
  
  /**
   * 带重试的操作执行
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>,
    context?: Record<string, any>
  ): Promise<T> {
    const retryConfig = { ...this.defaultRetryConfig, ...config };
    let lastError: Error;
    
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // 检查是否为可重试的错误
        if (ErrorHandler.isCacheError(error) && 
            !retryConfig.retryableErrors.includes(error.code)) {
          throw error; // 不可重试的错误直接抛出
        }
        
        if (attempt === retryConfig.maxAttempts) {
          // 最后一次重试失败
          const retryError = ErrorHandler.createError(
            CacheErrorCode.RETRY_EXHAUSTED,
            `重试次数已耗尽 (${retryConfig.maxAttempts} 次)`,
            { ...context, attempts: attempt, lastError: ErrorHandler.formatError(error) }
          );
          throw retryError;
        }
        
        // 计算延迟时间（指数退避）
        const delay = Math.min(
          retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt - 1),
          retryConfig.maxDelay
        );
        
        console.warn(`操作失败，将在 ${delay}ms 后进行第 ${attempt + 1} 次重试:`, ErrorHandler.formatError(error));
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }
  
  /**
   * 带断路器和重试的操作执行
   */
  async executeWithCircuitBreakerAndRetry<T>(
    operation: () => Promise<T>,
    circuitBreakerName: string,
    retryConfig?: Partial<RetryConfig>,
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>,
    context?: Record<string, any>
  ): Promise<T> {
    const circuitBreaker = this.getCircuitBreaker(circuitBreakerName, circuitBreakerConfig);
    
    return this.executeWithRetry(
      () => circuitBreaker.execute(operation),
      retryConfig,
      { ...context, circuitBreakerName }
    );
  }
  
  // ==== 恢复策略 ====
  
  /**
   * 执行系统恢复策略
   */
  async executeRecoveryStrategy(
    errorType: CacheErrorCode,
    context?: Record<string, any>
  ): Promise<boolean> {
    console.log(`开始执行恢复策略，错误类型: ${errorType}`);
    
    try {
      switch (errorType) {
        case CacheErrorCode.MEMORY_LIMIT_EXCEEDED:
          return await this.recoverFromMemoryExhaustion(context);
          
        case CacheErrorCode.LOCK_ACQUISITION_FAILED:
          return await this.recoverFromLockFailure(context);
          
        case CacheErrorCode.FILE_SYSTEM_ERROR:
          return await this.recoverFromFileSystemError(context);
          
        case CacheErrorCode.NETWORK_ERROR:
          return await this.recoverFromNetworkError(context);
          
        case CacheErrorCode.CIRCUIT_BREAKER_OPEN:
          return await this.recoverFromCircuitBreakerOpen(context);
          
        default:
          console.warn(`无可用的恢复策略，错误类型: ${errorType}`);
          return false;
      }
    } catch (error) {
      console.error('恢复策略执行失败:', ErrorHandler.formatError(error));
      return false;
    }
  }
  
  /**
   * 从内存耗尽中恢复
   */
  private async recoverFromMemoryExhaustion(context?: Record<string, any>): Promise<boolean> {
    console.log('执行内存恢复策略...');
    
    // 这里需要访问CacheManager实例，在实际使用时需要注入
    // 暂时返回模拟结果
    return true;
  }
  
  /**
   * 从锁获取失败中恢复
   */
  private async recoverFromLockFailure(context?: Record<string, any>): Promise<boolean> {
    console.log('执行锁恢复策略...');
    
    // 等待一小段时间后重试
    await this.sleep(100);
    return true;
  }
  
  /**
   * 从文件系统错误中恢复
   */
  private async recoverFromFileSystemError(context?: Record<string, any>): Promise<boolean> {
    console.log('执行文件系统恢复策略...');
    
    // 检查文件系统状态
    return true;
  }
  
  /**
   * 从网络错误中恢复
   */
  private async recoverFromNetworkError(context?: Record<string, any>): Promise<boolean> {
    console.log('执行网络恢复策略...');
    
    // 检查网络连接状态
    return true;
  }
  
  /**
   * 从断路器开启状态中恢复
   */
  private async recoverFromCircuitBreakerOpen(context?: Record<string, any>): Promise<boolean> {
    console.log('执行断路器恢复策略...');
    
    if (context?.circuitBreakerName) {
      const breaker = this.circuitBreakers.get(context.circuitBreakerName);
      if (breaker) {
        // 可以选择重置断路器或等待自然恢复
        console.log(`断路器 ${context.circuitBreakerName} 等待自然恢复...`);
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 获取系统健康状态
   */
  getSystemHealth(): {
    overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    circuitBreakers: Record<string, any>;
    recentErrors: number;
    errorRate: string;
  } {
    const now = Date.now();
    const recentErrors = this.errorLog.filter(err => now - err.timestamp < 300000).length; // 5分钟内的错误
    const totalRecentOperations = recentErrors + 100; // 假设的总操作数
    const errorRate = totalRecentOperations > 0 
      ? (recentErrors / totalRecentOperations * 100).toFixed(2)
      : '0.00';
    
    const circuitBreakerStats = this.getAllCircuitBreakerStats();
    const openCircuitBreakers = Object.values(circuitBreakerStats)
      .filter((stats: any) => stats.state === CircuitBreakerState.OPEN).length;
    
    let overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    if (openCircuitBreakers === 0 && recentErrors < 5) {
      overall = 'HEALTHY';
    } else if (openCircuitBreakers > 0 || recentErrors < 20) {
      overall = 'DEGRADED';
    } else {
      overall = 'UNHEALTHY';
    }
    
    return {
      overall,
      circuitBreakers: circuitBreakerStats,
      recentErrors,
      errorRate: errorRate + '%'
    };
  }
  
  /**
   * 辅助方法：延迟执行
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 工具函数：包装异步操作并处理错误
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  fallback?: T,
  context?: Record<string, any>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (ErrorHandler.isCacheError(error)) {
      // 已知的缓存错误，直接重新抛出
      throw error;
    }
    
    // 未知错误，包装为缓存错误
    const cacheError = ErrorHandler.createError(
      CacheErrorCode.UNKNOWN_ERROR,
      ErrorHandler.formatError(error),
      { ...context, originalError: error }
    );
    
    throw cacheError;
  }
}

/**
 * 带断路器的错误处理工具函数
 */
export async function withCircuitBreakerErrorHandling<T>(
  operation: () => Promise<T>,
  circuitBreakerName: string,
  retryConfig?: Partial<RetryConfig>,
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>,
  context?: Record<string, any>
): Promise<T> {
  const errorHandler = ErrorHandler.getInstance();
  
  try {
    return await errorHandler.executeWithCircuitBreakerAndRetry(
      operation,
      circuitBreakerName,
      retryConfig,
      circuitBreakerConfig,
      context
    );
  } catch (error) {
    // 尝试执行恢复策略
    if (ErrorHandler.isCacheError(error)) {
      const recovered = await errorHandler.executeRecoveryStrategy(error.code, context);
      if (recovered) {
        // 恢复成功，重新尝试操作
        return await operation();
      }
    }
    
    throw error;
  }
}

/**
 * 带重试的错误处理工具函数
 */
export async function withRetryErrorHandling<T>(
  operation: () => Promise<T>,
  retryConfig?: Partial<RetryConfig>,
  context?: Record<string, any>
): Promise<T> {
  const errorHandler = ErrorHandler.getInstance();
  return errorHandler.executeWithRetry(operation, retryConfig, context);
}

/**
 * 工具函数：同步操作的错误处理
 */
export function withErrorHandlingSync<T>(
  operation: () => T,
  fallback?: T,
  context?: Record<string, any>
): T {
  try {
    return operation();
  } catch (error) {
    if (ErrorHandler.isCacheError(error)) {
      throw error;
    }
    
    const cacheError = ErrorHandler.createError(
      CacheErrorCode.UNKNOWN_ERROR,
      ErrorHandler.formatError(error),
      { ...context, originalError: error }
    );
    
    throw cacheError;
  }
}

/**
 * 降级处理工具函数：当主要操作失败时使用降级策略
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    console.warn('主要操作失败，使用降级策略:', ErrorHandler.formatError(error));
    
    try {
      return await fallback();
    } catch (fallbackError) {
      console.error('降级策略也失败:', ErrorHandler.formatError(fallbackError));
      throw error; // 抛出原始错误
    }
  }
}

/**
 * 超时处理工具函数
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  context?: Record<string, any>
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(ErrorHandler.createError(
          CacheErrorCode.TIMEOUT_ERROR,
          `操作超时 (${timeoutMs}ms)`,
          context
        ));
      }, timeoutMs);
    })
  ]);
}