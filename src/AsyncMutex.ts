/**
 * 异步互斥锁实现
 * 用于保证缓存操作的并发安全
 */

export class AsyncMutex {
  private locked = false;
  private waitingQueue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  /**
   * 获取锁
   */
  async lock(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.waitingQueue.push({ resolve, reject });
      }
    });
  }

  /**
   * 释放锁
   */
  unlock(): void {
    if (!this.locked) {
      throw new Error('试图释放未锁定的互斥锁');
    }

    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift()!;
      next.resolve();
    } else {
      this.locked = false;
    }
  }

  /**
   * 执行需要锁保护的操作
   */
  async runExclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    await this.lock();
    try {
      return await operation();
    } finally {
      this.unlock();
    }
  }

  /**
   * 获取当前锁状态
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * 获取等待队列长度
   */
  getQueueLength(): number {
    return this.waitingQueue.length;
  }
}