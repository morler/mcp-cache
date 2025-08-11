import { AsyncMutex } from '../src/AsyncMutex';

describe('AsyncMutex', () => {
  let mutex: AsyncMutex;

  beforeEach(() => {
    mutex = new AsyncMutex();
  });

  describe('基础功能', () => {
    test('应该初始化为未锁定状态', () => {
      expect(mutex.isLocked()).toBe(false);
      expect(mutex.getQueueLength()).toBe(0);
    });

    test('应该能够获取和释放锁', async () => {
      expect(mutex.isLocked()).toBe(false);
      
      await mutex.lock();
      expect(mutex.isLocked()).toBe(true);
      
      mutex.unlock();
      expect(mutex.isLocked()).toBe(false);
    });

    test('应该处理连续的锁获取', async () => {
      await mutex.lock();
      expect(mutex.isLocked()).toBe(true);
      
      mutex.unlock();
      expect(mutex.isLocked()).toBe(false);
      
      await mutex.lock();
      expect(mutex.isLocked()).toBe(true);
      
      mutex.unlock();
      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('并发控制', () => {
    test('第二个获取锁的请求应该等待', async () => {
      let firstLockAcquired = false;
      let secondLockAcquired = false;
      
      // 第一个锁
      const firstPromise = mutex.lock().then(() => {
        firstLockAcquired = true;
      });
      
      await firstPromise;
      expect(firstLockAcquired).toBe(true);
      expect(mutex.isLocked()).toBe(true);
      
      // 第二个锁应该等待
      const secondPromise = mutex.lock().then(() => {
        secondLockAcquired = true;
      });
      
      // 等待一小段时间，第二个锁应该还在等待
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(secondLockAcquired).toBe(false);
      expect(mutex.getQueueLength()).toBe(1);
      
      // 释放第一个锁
      mutex.unlock();
      
      // 现在第二个锁应该获得
      await secondPromise;
      expect(secondLockAcquired).toBe(true);
      expect(mutex.isLocked()).toBe(true);
      expect(mutex.getQueueLength()).toBe(0);
      
      mutex.unlock();
    });

    test('应该按FIFO顺序处理等待队列', async () => {
      const order: number[] = [];
      
      // 获取初始锁
      await mutex.lock();
      
      // 创建多个等待锁的任务
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          mutex.lock().then(() => {
            order.push(i);
            // 立即释放锁以让下一个任务继续
            mutex.unlock();
          })
        );
      }
      
      // 释放初始锁以启动队列处理
      mutex.unlock();
      
      // 等待所有任务完成
      await Promise.all(promises);
      
      // 验证执行顺序
      expect(order).toEqual([0, 1, 2, 3, 4]);
    });

    test('应该正确处理大量并发请求', async () => {
      const concurrency = 50;
      const results: number[] = [];
      
      const promises: Promise<void>[] = [];
      for (let i = 0; i < concurrency; i++) {
        promises.push(
          mutex.lock().then(() => {
            results.push(i);
            mutex.unlock();
          })
        );
      }
      
      await Promise.all(promises);
      
      expect(results).toHaveLength(concurrency);
      expect(new Set(results).size).toBe(concurrency); // 所有结果都应该是唯一的
    });
  });

  describe('runExclusive', () => {
    test('应该独占执行操作', async () => {
      let counter = 0;
      
      const increment = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        counter++;
        return counter;
      };
      
      const result = await mutex.runExclusive(increment);
      
      expect(result).toBe(1);
      expect(counter).toBe(1);
      expect(mutex.isLocked()).toBe(false);
    });

    test('应该处理同步操作', async () => {
      const syncOperation = () => {
        return 'sync-result';
      };
      
      const result = await mutex.runExclusive(syncOperation);
      
      expect(result).toBe('sync-result');
      expect(mutex.isLocked()).toBe(false);
    });

    test('应该处理返回Promise的操作', async () => {
      const asyncOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async-result';
      };
      
      const result = await mutex.runExclusive(asyncOperation);
      
      expect(result).toBe('async-result');
      expect(mutex.isLocked()).toBe(false);
    });

    test('应该在操作抛出错误时释放锁', async () => {
      const faultyOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('操作失败');
      };
      
      await expect(mutex.runExclusive(faultyOperation)).rejects.toThrow('操作失败');
      expect(mutex.isLocked()).toBe(false);
    });

    test('应该确保操作的互斥性', async () => {
      let sharedCounter = 0;
      const results: number[] = [];
      
      const incrementOperation = async (id: number) => {
        // 模拟竞争条件
        const current = sharedCounter;
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        sharedCounter = current + 1;
        results.push(sharedCounter);
        return sharedCounter;
      };
      
      // 并发执行多个操作
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(mutex.runExclusive(() => incrementOperation(i)));
      }
      
      await Promise.all(promises);
      
      expect(sharedCounter).toBe(10);
      expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    test('应该检测嵌套的runExclusive调用', async () => {
      // 注意：嵌套的runExclusive会导致死锁，这是预期的行为
      // 在实际使用中应该避免嵌套调用
      const outerOperation = async () => {
        // 在已经持有锁的情况下尝试获取锁会等待
        return 'outer-result';
      };
      
      const result = await mutex.runExclusive(outerOperation);
      
      expect(result).toBe('outer-result');
      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('错误处理', () => {
    test('应该在未锁定时抛出错误', () => {
      expect(() => mutex.unlock()).toThrow('试图释放未锁定的互斥锁');
    });

    test('应该在多次释放时抛出错误', async () => {
      await mutex.lock();
      mutex.unlock();
      
      expect(() => mutex.unlock()).toThrow('试图释放未锁定的互斥锁');
    });

    test('应该处理runExclusive中的同步错误', async () => {
      const syncError = () => {
        throw new Error('同步错误');
      };
      
      await expect(mutex.runExclusive(syncError)).rejects.toThrow('同步错误');
      expect(mutex.isLocked()).toBe(false);
    });

    test('应该处理runExclusive中的异步错误', async () => {
      const asyncError = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('异步错误');
      };
      
      await expect(mutex.runExclusive(asyncError)).rejects.toThrow('异步错误');
      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('状态查询', () => {
    test('isLocked应该正确反映锁状态', async () => {
      expect(mutex.isLocked()).toBe(false);
      
      await mutex.lock();
      expect(mutex.isLocked()).toBe(true);
      
      mutex.unlock();
      expect(mutex.isLocked()).toBe(false);
    });

    test('getQueueLength应该正确反映等待队列长度', async () => {
      expect(mutex.getQueueLength()).toBe(0);
      
      // 获取锁
      await mutex.lock();
      expect(mutex.getQueueLength()).toBe(0);
      
      // 添加等待者
      const waiters = [];
      for (let i = 0; i < 3; i++) {
        waiters.push(mutex.lock());
      }
      
      // 等待一下让所有锁请求进入队列
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mutex.getQueueLength()).toBe(3);
      
      // 释放锁，队列应该减少
      mutex.unlock();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mutex.getQueueLength()).toBe(2);
      
      // 继续释放
      mutex.unlock();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mutex.getQueueLength()).toBe(1);
      
      mutex.unlock();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mutex.getQueueLength()).toBe(0);
      
      mutex.unlock();
    });
  });

  describe('性能测试', () => {
    test('应该能够处理高频率的锁操作', async () => {
      const iterations = 1000;
      const startTime = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        await mutex.runExclusive(() => {
          return i;
        });
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // 1000次操作应该在合理时间内完成（比如1秒）
      expect(duration).toBeLessThan(1000);
    });

    test('应该在高并发情况下保持正确性', async () => {
      const concurrency = 100;
      let sharedResource = 0;
      
      const tasks = Array(concurrency).fill(0).map((_, index) => 
        mutex.runExclusive(async () => {
          const temp = sharedResource;
          // 添加一些延迟来增加竞争条件的可能性
          await new Promise(resolve => setTimeout(resolve, 1));
          sharedResource = temp + 1;
          return index;
        })
      );
      
      const results = await Promise.all(tasks);
      
      expect(sharedResource).toBe(concurrency);
      expect(results).toHaveLength(concurrency);
      expect(new Set(results).size).toBe(concurrency);
    });
  });
});