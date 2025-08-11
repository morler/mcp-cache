import * as crypto from 'crypto';

export interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
}

export interface EncryptedData {
  data: string;
  iv: string;
  tag?: string;
}

export class DataEncryptor {
  private config: EncryptionConfig;
  private key: Buffer;

  constructor(encryptionKey?: string, config?: Partial<EncryptionConfig>) {
    this.config = {
      algorithm: config?.algorithm || 'aes-256-gcm',
      keyLength: config?.keyLength || 32,
      ivLength: config?.ivLength || 16,
      ...config
    };

    // 生成或使用提供的加密密钥
    if (encryptionKey) {
      this.key = Buffer.from(encryptionKey, 'hex');
    } else {
      this.key = crypto.randomBytes(this.config.keyLength);
    }
  }

  /**
   * 加密数据
   */
  encrypt(data: any): EncryptedData {
    try {
      const iv = crypto.randomBytes(this.config.ivLength);
      const cipher = crypto.createCipheriv(this.config.algorithm, this.key, iv);
      
      const plaintext = JSON.stringify(data);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const result: EncryptedData = {
        data: encrypted,
        iv: iv.toString('hex')
      };

      // 对于 GCM 模式，添加认证标签
      if (this.config.algorithm.includes('gcm')) {
        const gcmCipher = cipher as any;
        if (gcmCipher.getAuthTag) {
          result.tag = gcmCipher.getAuthTag().toString('hex');
        }
      }

      return result;
    } catch (error) {
      throw new Error(`加密失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 解密数据
   */
  decrypt(encryptedData: EncryptedData): any {
    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const decipher = crypto.createDecipheriv(this.config.algorithm, this.key, iv);
      
      // 对于 GCM 模式，设置认证标签
      if (this.config.algorithm.includes('gcm') && encryptedData.tag) {
        const gcmDecipher = decipher as any;
        if (gcmDecipher.setAuthTag) {
          gcmDecipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
        }
      }

      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (error) {
      throw new Error(`解密失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取密钥（用于配置保存）
   */
  getKeyHex(): string {
    return this.key.toString('hex');
  }

  /**
   * 检查数据是否需要加密
   */
  static shouldEncrypt(key: string, value: any, sensitivePatterns: string[] = []): boolean {
    const keyLower = key.toLowerCase();
    const valueStr = JSON.stringify(value).toLowerCase();

    // 默认敏感数据模式
    const defaultPatterns = [
      'password', 'token', 'secret', 'key', 'auth', 'credential',
      'private', 'confidential', 'secure', 'sensitive'
    ];

    const allPatterns = [...defaultPatterns, ...sensitivePatterns];

    // 检查键名是否包含敏感词
    for (const pattern of allPatterns) {
      if (keyLower.includes(pattern) || valueStr.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 生成新的加密密钥
   */
  static generateKey(keyLength: number = 32): string {
    return crypto.randomBytes(keyLength).toString('hex');
  }
}

/**
 * 简单的访问控制
 */
export class AccessController {
  private allowedOperations: Set<string>;
  private restrictedKeys: Set<string>;
  private keyPatterns: RegExp[];

  constructor(config?: {
    allowedOperations?: string[];
    restrictedKeys?: string[];
    restrictedPatterns?: string[];
  }) {
    this.allowedOperations = new Set(config?.allowedOperations || ['get', 'set', 'delete', 'clear']);
    this.restrictedKeys = new Set(config?.restrictedKeys || []);
    this.keyPatterns = (config?.restrictedPatterns || []).map(pattern => new RegExp(pattern, 'i'));
  }

  /**
   * 检查操作是否被允许
   */
  isOperationAllowed(operation: string): boolean {
    return this.allowedOperations.has(operation);
  }

  /**
   * 检查键是否被限制访问
   */
  isKeyRestricted(key: string): boolean {
    // 检查直接限制的键
    if (this.restrictedKeys.has(key)) {
      return true;
    }

    // 检查模式匹配
    for (const pattern of this.keyPatterns) {
      if (pattern.test(key)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 验证访问权限
   */
  validateAccess(operation: string, key?: string): void {
    if (!this.isOperationAllowed(operation)) {
      throw new Error(`操作被拒绝: ${operation}`);
    }

    if (key && this.isKeyRestricted(key)) {
      throw new Error(`访问被拒绝: 键 "${key}" 被限制访问`);
    }
  }

  /**
   * 添加受限制的键
   */
  addRestrictedKey(key: string): void {
    this.restrictedKeys.add(key);
  }

  /**
   * 移除受限制的键
   */
  removeRestrictedKey(key: string): void {
    this.restrictedKeys.delete(key);
  }

  /**
   * 添加受限制的操作
   */
  addAllowedOperation(operation: string): void {
    this.allowedOperations.add(operation);
  }

  /**
   * 移除允许的操作
   */
  removeAllowedOperation(operation: string): void {
    this.allowedOperations.delete(operation);
  }
}