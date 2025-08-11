/**
 * 内存计算工具集
 * 提供更精确的内存使用量计算方法
 */

/**
 * 缓存条目的内存占用信息
 */
export interface MemoryInfo {
  /** 值本身的内存占用（字节） */
  valueSize: number;
  /** 键的内存占用（字节） */
  keySize: number;
  /** 元数据的内存占用（字节） */
  metadataSize: number;
  /** 总内存占用（字节） */
  totalSize: number;
  /** 计算方法描述 */
  method: string;
}

/**
 * 估算字符串的内存占用（UTF-16编码）
 */
function calculateStringSize(str: string): number {
  // JavaScript字符串使用UTF-16编码，每个字符占用2字节
  // 但需要考虑代理对（surrogate pairs）
  let size = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDFFF) {
      // 代理对，占用4字节
      size += 4;
      i++; // 跳过下一个字符（代理对的低位）
    } else {
      // 普通字符，占用2字节
      size += 2;
    }
  }
  return size;
}

/**
 * 估算数字的内存占用
 */
function calculateNumberSize(num: number): number {
  // JavaScript中的数字都是64位双精度浮点数
  return 8;
}

/**
 * 估算布尔值的内存占用
 */
function calculateBooleanSize(): number {
  // 布尔值通常占用1字节，但在V8中可能有对齐填充
  return 4; // 考虑对齐，使用4字节
}

/**
 * 估算对象的内存占用（递归计算）
 */
function calculateObjectSize(obj: any, visited = new WeakSet()): number {
  if (obj === null || obj === undefined) {
    return 4; // 空指针占用4字节
  }

  // 防止循环引用导致的无限递归
  if (visited.has(obj)) {
    return 8; // 引用占用8字节
  }

  const type = typeof obj;
  let size = 0;

  switch (type) {
    case 'string':
      return calculateStringSize(obj);
    
    case 'number':
      return calculateNumberSize(obj);
    
    case 'boolean':
      return calculateBooleanSize();
    
    case 'object':
      if (Array.isArray(obj)) {
        visited.add(obj);
        // 数组头部信息（长度等）
        size += 24;
        // 每个元素
        for (const item of obj) {
          size += calculateObjectSize(item, visited);
        }
        visited.delete(obj);
        return size;
      } else if (obj instanceof Date) {
        return 24; // Date对象的固定大小
      } else if (obj instanceof RegExp) {
        return 48 + calculateStringSize(obj.source); // RegExp对象 + 模式字符串
      } else if (obj instanceof Map) {
        visited.add(obj);
        size += 32; // Map头部信息
        for (const [key, value] of obj.entries()) {
          size += calculateObjectSize(key, visited);
          size += calculateObjectSize(value, visited);
          size += 16; // 每个键值对的存储开销
        }
        visited.delete(obj);
        return size;
      } else if (obj instanceof Set) {
        visited.add(obj);
        size += 32; // Set头部信息
        for (const value of obj.values()) {
          size += calculateObjectSize(value, visited);
          size += 8; // 每个值的存储开销
        }
        visited.delete(obj);
        return size;
      } else {
        // 普通对象
        visited.add(obj);
        size += 32; // 对象头部信息
        for (const [key, value] of Object.entries(obj)) {
          size += calculateStringSize(key); // 属性名
          size += calculateObjectSize(value, visited); // 属性值
          size += 16; // 每个属性的存储开销
        }
        visited.delete(obj);
        return size;
      }
    
    case 'function':
      // 函数的大小很难准确估算，使用固定值
      return 64 + calculateStringSize(obj.toString());
    
    default:
      return 8; // 其他类型（如symbol）的默认大小
  }
}

/**
 * 更精确的内存计算方法
 */
export function calculateMemoryUsage(key: string, value: any): MemoryInfo {
  const keySize = calculateStringSize(key);
  const valueSize = calculateObjectSize(value);
  
  // 元数据包括：创建时间、最后访问时间、TTL、大小等字段
  const metadataSize = 8 + 8 + 4 + 4 + 8; // 32字节的元数据
  
  const totalSize = keySize + valueSize + metadataSize;

  return {
    valueSize,
    keySize,
    metadataSize,
    totalSize,
    method: 'precise-calculation'
  };
}

/**
 * 快速内存估算方法（性能优先）
 */
export function calculateMemoryUsageFast(key: string, value: any): MemoryInfo {
  const keySize = key.length * 2; // 简单的UTF-16计算
  
  let valueSize: number;
  const type = typeof value;
  
  if (type === 'string') {
    valueSize = value.length * 2;
  } else if (type === 'number') {
    valueSize = 8;
  } else if (type === 'boolean') {
    valueSize = 4;
  } else if (value === null || value === undefined) {
    valueSize = 4;
  } else {
    // 对于复杂对象，使用JSON序列化长度作为近似值
    try {
      const jsonStr = JSON.stringify(value);
      valueSize = jsonStr.length * 2;
    } catch (error) {
      // 如果JSON序列化失败（如循环引用），使用固定估值
      valueSize = 1024;
    }
  }
  
  const metadataSize = 32;
  const totalSize = keySize + valueSize + metadataSize;

  return {
    valueSize,
    keySize,
    metadataSize,
    totalSize,
    method: 'fast-estimation'
  };
}

/**
 * 根据配置选择合适的内存计算方法
 */
export function calculateMemoryUsageAdaptive(
  key: string, 
  value: any, 
  options: { 
    precise?: boolean;
    maxSizeForPrecise?: number;
  } = {}
): MemoryInfo {
  const { precise = false, maxSizeForPrecise = 10240 } = options;
  
  // 如果值太大，使用快速方法避免性能问题
  if (!precise) {
    const fastResult = calculateMemoryUsageFast(key, value);
    if (fastResult.valueSize > maxSizeForPrecise) {
      return fastResult;
    }
  }
  
  try {
    return calculateMemoryUsage(key, value);
  } catch (error) {
    // 如果精确计算失败，回退到快速方法
    return calculateMemoryUsageFast(key, value);
  }
}

/**
 * 验证内存计算的准确性（用于测试）
 */
export function validateMemoryCalculation(key: string, value: any): {
  fast: MemoryInfo;
  precise: MemoryInfo;
  difference: number;
  accuracyRatio: number;
} {
  const fast = calculateMemoryUsageFast(key, value);
  const precise = calculateMemoryUsage(key, value);
  const difference = Math.abs(precise.totalSize - fast.totalSize);
  const accuracyRatio = Math.min(fast.totalSize, precise.totalSize) / Math.max(fast.totalSize, precise.totalSize);
  
  return {
    fast,
    precise,
    difference,
    accuracyRatio
  };
}