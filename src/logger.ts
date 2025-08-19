/**
 * Logger utility for MCP server
 * Redirects all logging to stderr to avoid interfering with MCP JSON protocol on stdout
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private currentLevel: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  debug(...args: any[]): void {
    if (this.currentLevel <= LogLevel.DEBUG) {
      console.error('[DEBUG]', ...args);
    }
  }

  info(...args: any[]): void {
    if (this.currentLevel <= LogLevel.INFO) {
      console.error('[INFO]', ...args);
    }
  }

  warn(...args: any[]): void {
    if (this.currentLevel <= LogLevel.WARN) {
      console.error('[WARN]', ...args);
    }
  }

  error(...args: any[]): void {
    if (this.currentLevel <= LogLevel.ERROR) {
      console.error('[ERROR]', ...args);
    }
  }
}

export const logger = new Logger();