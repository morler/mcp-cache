import {
  validateString,
  validateNumber,
  validateCacheKey,
  validateTTL,
  validateStoreArgs,
  validateRetrieveArgs,
  validateClearArgs,
  formatValidationErrors,
  ValidationResult
} from '../src/validators';

describe('Validators', () => {
  describe('validateString', () => {
    test('应该验证有效字符串', () => {
      const result = validateString('valid-string', 'test-field');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('应该拒绝空值（必需字段）', () => {
      const result = validateString(null, 'test-field', { required: true });
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('字段是必需的');
    });

    test('应该允许空值（可选字段）', () => {
      const result = validateString(null, 'test-field', { required: false });
      expect(result.isValid).toBe(true);
    });

    test('应该验证字符串长度', () => {
      const tooShort = validateString('ab', 'test', { minLength: 3 });
      expect(tooShort.isValid).toBe(false);
      
      const tooLong = validateString('abcdef', 'test', { maxLength: 5 });
      expect(tooLong.isValid).toBe(false);
      
      const justRight = validateString('abc', 'test', { minLength: 3, maxLength: 5 });
      expect(justRight.isValid).toBe(true);
    });

    test('应该验证正则表达式模式', () => {
      const pattern = /^[a-z]+$/;
      const valid = validateString('hello', 'test', { pattern });
      expect(valid.isValid).toBe(true);
      
      const invalid = validateString('Hello123', 'test', { pattern });
      expect(invalid.isValid).toBe(false);
    });
  });

  describe('validateNumber', () => {
    test('应该验证有效数字', () => {
      const result = validateNumber(42, 'test-field');
      expect(result.isValid).toBe(true);
    });

    test('应该拒绝NaN', () => {
      const result = validateNumber(NaN, 'test-field');
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toBe('必须是有效数字');
    });

    test('应该验证数字范围', () => {
      const tooSmall = validateNumber(5, 'test', { min: 10 });
      expect(tooSmall.isValid).toBe(false);
      
      const tooBig = validateNumber(15, 'test', { max: 10 });
      expect(tooBig.isValid).toBe(false);
      
      const justRight = validateNumber(10, 'test', { min: 5, max: 15 });
      expect(justRight.isValid).toBe(true);
    });

    test('应该验证整数要求', () => {
      const validInt = validateNumber(10, 'test', { integer: true });
      expect(validInt.isValid).toBe(true);
      
      const invalidInt = validateNumber(10.5, 'test', { integer: true });
      expect(invalidInt.isValid).toBe(false);
    });
  });

  describe('validateCacheKey', () => {
    test('应该验证有效缓存键', () => {
      const validKeys = ['valid-key', 'user:123', 'cache.item', 'key_with_underscore'];
      
      for (const key of validKeys) {
        const result = validateCacheKey(key);
        expect(result.isValid).toBe(true);
      }
    });

    test('应该拒绝无效缓存键', () => {
      const invalidKeys = ['', 'key with spaces', 'key@invalid', 'key#invalid', 'a'.repeat(251)];
      
      for (const key of invalidKeys) {
        const result = validateCacheKey(key);
        expect(result.isValid).toBe(false);
      }
    });
  });

  describe('validateTTL', () => {
    test('应该验证有效TTL值', () => {
      const validTTLs = [1, 3600, 86400, 31536000];
      
      for (const ttl of validTTLs) {
        const result = validateTTL(ttl);
        expect(result.isValid).toBe(true);
      }
    });

    test('应该允许undefined TTL（可选）', () => {
      const result = validateTTL(undefined);
      expect(result.isValid).toBe(true);
    });

    test('应该拒绝无效TTL值', () => {
      const invalidTTLs = [0, -1, 31536001, 3.14]; // 0, 负数, 超过1年, 小数
      
      for (const ttl of invalidTTLs) {
        const result = validateTTL(ttl);
        expect(result.isValid).toBe(false);
      }
    });
  });

  describe('validateStoreArgs', () => {
    test('应该验证有效存储参数', () => {
      const validArgs = {
        key: 'valid-key',
        value: { data: 'test' },
        ttl: 3600
      };
      
      const result = validateStoreArgs(validArgs);
      expect(result.isValid).toBe(true);
    });

    test('应该验证不带TTL的参数', () => {
      const validArgs = {
        key: 'valid-key',
        value: 'simple-value'
      };
      
      const result = validateStoreArgs(validArgs);
      expect(result.isValid).toBe(true);
    });

    test('应该拒绝undefined值', () => {
      const invalidArgs = {
        key: 'valid-key',
        value: undefined
      };
      
      const result = validateStoreArgs(invalidArgs);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'value')).toBe(true);
    });

    test('应该拒绝无效键', () => {
      const invalidArgs = {
        key: '',
        value: 'valid-value'
      };
      
      const result = validateStoreArgs(invalidArgs);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'key')).toBe(true);
    });
  });

  describe('validateRetrieveArgs', () => {
    test('应该验证有效检索参数', () => {
      const result = validateRetrieveArgs({ key: 'valid-key' });
      expect(result.isValid).toBe(true);
    });

    test('应该拒绝无效键', () => {
      const result = validateRetrieveArgs({ key: '' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateClearArgs', () => {
    test('应该验证有效清除参数（带键）', () => {
      const result = validateClearArgs({ key: 'valid-key' });
      expect(result.isValid).toBe(true);
    });

    test('应该验证空参数（清除所有）', () => {
      const result = validateClearArgs({});
      expect(result.isValid).toBe(true);
    });

    test('应该验证undefined键（清除所有）', () => {
      const result = validateClearArgs({ key: undefined });
      expect(result.isValid).toBe(true);
    });

    test('应该拒绝无效键', () => {
      const result = validateClearArgs({ key: '' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('formatValidationErrors', () => {
    test('应该格式化单个错误', () => {
      const errors = [{ field: 'test', message: '测试错误' }];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toBe('test: 测试错误');
    });

    test('应该格式化多个错误', () => {
      const errors = [
        { field: 'field1', message: '错误1' },
        { field: 'field2', message: '错误2', received: 'invalid-value' }
      ];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toBe('field1: 错误1; field2: 错误2 (收到: invalid-value)');
    });
  });

  describe('ValidationResult', () => {
    test('应该创建成功结果', () => {
      const result = ValidationResult.success();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('应该创建错误结果', () => {
      const errors = [{ field: 'test', message: '测试错误' }];
      const result = ValidationResult.error(errors);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(errors);
    });

    test('应该创建单个错误结果', () => {
      const result = ValidationResult.singleError('test', '测试错误', 'invalid');
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: 'test',
        message: '测试错误',
        received: 'invalid'
      });
    });
  });
});