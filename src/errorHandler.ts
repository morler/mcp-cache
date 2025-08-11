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
  GIT_REPOSITORY_ERROR = 5001,
  NETWORK_ERROR = 5002,
  
  // 安全错误 (6000-6999)
  ACCESS_DENIED = 6000,
  ENCRYPTION_ERROR = 6001,
  AUTHENTICATION_FAILED = 6002
}

export interface CacheErrorDetails {
  code: CacheErrorCode;
  message: string;
  details?: Record<string, any>;
  stack?: string;
  timestamp: number;
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

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: CacheErrorDetails[] = [];
  private maxLogSize: number = 1000;

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