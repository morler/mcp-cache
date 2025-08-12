#!/usr/bin/env node

import { ErrorHandler, CircuitBreakerState } from './build/errorHandler.js';

async function testErrorHandler() {
  console.log('🛡️ 测试 ErrorHandler 功能...\n');
  
  const errorHandler = ErrorHandler.getInstance();
  
  try {
    // 1. 测试断路器基本功能
    console.log('1. 测试断路器基本功能...');
    const breaker = errorHandler.getCircuitBreaker('test-service', {
      failureThreshold: 2,
      recoveryTimeout: 2000,
      halfOpenMaxCalls: 1
    });
    
    console.log('✅ 初始状态:', breaker.getState() === CircuitBreakerState.CLOSED);
    
    // 模拟失败操作
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error(`失败 ${i + 1}`);
        });
      } catch (error) {
        console.log(`  失败 ${i + 1}:`, error.message);
      }
    }
    
    console.log('✅ 失败后状态:', breaker.getState() === CircuitBreakerState.OPEN);
    
    // 2. 测试重试机制
    console.log('\n2. 测试重试机制...');
    let attempts = 0;
    
    try {
      const result = await errorHandler.executeWithRetry(async () => {
        attempts++;
        console.log(`  重试尝试 ${attempts}`);
        if (attempts < 3) {
          throw new Error(`重试失败 ${attempts}`);
        }
        return `成功于第 ${attempts} 次`;
      }, {
        maxAttempts: 5,
        initialDelay: 100,
        backoffMultiplier: 1.2
      });
      
      console.log('✅ 重试成功:', result);
    } catch (error) {
      console.log('❌ 重试失败:', error.message);
    }
    
    // 3. 测试系统健康状态
    console.log('\n3. 测试系统健康状态...');
    const health = errorHandler.getSystemHealth();
    console.log('✅ 系统状态:', health.overall);
    console.log('✅ 断路器数量:', Object.keys(health.circuitBreakers).length);
    
    // 4. 测试断路器重置
    console.log('\n4. 测试断路器重置...');
    errorHandler.resetAllCircuitBreakers();
    console.log('✅ 断路器已重置');
    
    console.log('\n🎉 ErrorHandler 测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testErrorHandler();