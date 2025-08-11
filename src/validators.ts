/**
 * 输入验证工具集
 * 提供类型安全的参数验证功能
 */

export interface ValidationError {
  field: string;
  message: string;
  received?: any;
}

export class ValidationResult {
  constructor(
    public isValid: boolean,
    public errors: ValidationError[] = []
  ) {}

  static success(): ValidationResult {
    return new ValidationResult(true);
  }

  static error(errors: ValidationError[]): ValidationResult {
    return new ValidationResult(false, errors);
  }

  static singleError(field: string, message: string, received?: any): ValidationResult {
    return new ValidationResult(false, [{ field, message, received }]);
  }
}

/**
 * 验证字符串参数
 */
export function validateString(
  value: any,
  field: string,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
  } = {}
): ValidationResult {
  const { required = true, minLength, maxLength, pattern } = options;
  const errors: ValidationError[] = [];

  // 检查是否为必需字段
  if (required && (value === undefined || value === null)) {
    errors.push({ field, message: '字段是必需的', received: value });
    return ValidationResult.error(errors);
  }

  // 如果不是必需字段且值为空，直接返回成功
  if (!required && (value === undefined || value === null)) {
    return ValidationResult.success();
  }

  // 检查类型
  if (typeof value !== 'string') {
    errors.push({ 
      field, 
      message: '必须是字符串类型', 
      received: typeof value 
    });
    return ValidationResult.error(errors);
  }

  // 检查长度
  if (minLength !== undefined && value.length < minLength) {
    errors.push({
      field,
      message: `长度不能少于${minLength}个字符`,
      received: value.length
    });
  }

  if (maxLength !== undefined && value.length > maxLength) {
    errors.push({
      field,
      message: `长度不能超过${maxLength}个字符`,
      received: value.length
    });
  }

  // 检查正则表达式
  if (pattern && !pattern.test(value)) {
    errors.push({
      field,
      message: `格式不符合要求`,
      received: value
    });
  }

  return errors.length > 0 ? ValidationResult.error(errors) : ValidationResult.success();
}

/**
 * 验证数字参数
 */
export function validateNumber(
  value: any,
  field: string,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
  } = {}
): ValidationResult {
  const { required = true, min, max, integer = false } = options;
  const errors: ValidationError[] = [];

  // 检查是否为必需字段
  if (required && (value === undefined || value === null)) {
    errors.push({ field, message: '字段是必需的', received: value });
    return ValidationResult.error(errors);
  }

  // 如果不是必需字段且值为空，直接返回成功
  if (!required && (value === undefined || value === null)) {
    return ValidationResult.success();
  }

  // 检查类型
  if (typeof value !== 'number' || isNaN(value)) {
    errors.push({ 
      field, 
      message: '必须是有效数字', 
      received: typeof value === 'number' ? 'NaN' : typeof value 
    });
    return ValidationResult.error(errors);
  }

  // 检查是否为整数
  if (integer && !Number.isInteger(value)) {
    errors.push({
      field,
      message: '必须是整数',
      received: value
    });
  }

  // 检查范围
  if (min !== undefined && value < min) {
    errors.push({
      field,
      message: `不能小于${min}`,
      received: value
    });
  }

  if (max !== undefined && value > max) {
    errors.push({
      field,
      message: `不能大于${max}`,
      received: value
    });
  }

  return errors.length > 0 ? ValidationResult.error(errors) : ValidationResult.success();
}

/**
 * 验证缓存键
 */
export function validateCacheKey(key: any): ValidationResult {
  return validateString(key, 'key', {
    required: true,
    minLength: 1,
    maxLength: 250,
    pattern: /^[a-zA-Z0-9_:.-]+$/
  });
}

/**
 * 验证TTL值
 */
export function validateTTL(ttl: any): ValidationResult {
  return validateNumber(ttl, 'ttl', {
    required: false,
    min: 1,
    max: 31536000, // 1年
    integer: true
  });
}

/**
 * 验证存储操作参数
 */
export function validateStoreArgs(args: any): ValidationResult {
  if (!args || typeof args !== 'object') {
    return ValidationResult.singleError('arguments', '参数必须是对象');
  }

  const errors: ValidationError[] = [];

  // 验证key
  const keyResult = validateCacheKey(args.key);
  if (!keyResult.isValid) {
    errors.push(...keyResult.errors);
  }

  // 验证value（任何非undefined值都可以）
  if (args.value === undefined) {
    errors.push({
      field: 'value',
      message: '值不能为undefined',
      received: 'undefined'
    });
  }

  // 验证TTL（可选）
  if ('ttl' in args) {
    const ttlResult = validateTTL(args.ttl);
    if (!ttlResult.isValid) {
      errors.push(...ttlResult.errors);
    }
  }

  return errors.length > 0 ? ValidationResult.error(errors) : ValidationResult.success();
}

/**
 * 验证获取操作参数
 */
export function validateRetrieveArgs(args: any): ValidationResult {
  if (!args || typeof args !== 'object') {
    return ValidationResult.singleError('arguments', '参数必须是对象');
  }

  return validateCacheKey(args.key);
}

/**
 * 验证清除操作参数
 */
export function validateClearArgs(args: any): ValidationResult {
  if (!args || typeof args !== 'object') {
    return ValidationResult.singleError('arguments', '参数必须是对象');
  }

  // key是可选的，如果提供则需要验证
  if ('key' in args && args.key !== undefined) {
    return validateCacheKey(args.key);
  }

  return ValidationResult.success();
}

/**
 * 格式化验证错误信息
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map(err => `${err.field}: ${err.message}${err.received !== undefined ? ` (收到: ${err.received})` : ''}`).join('; ');
}