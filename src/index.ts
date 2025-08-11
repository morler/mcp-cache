#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CacheManager } from './CacheManager.js';
import { 
  validateStoreArgs, 
  validateRetrieveArgs, 
  validateClearArgs,
  formatValidationErrors 
} from './validators.js';
import fs from 'fs-extra';
import path from 'path';

class MemoryCacheServer {
  private server: Server;
  private cacheManager: CacheManager;

  constructor() {
    // Load configuration
    const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.json');
    const config = fs.existsSync(configPath) 
      ? fs.readJsonSync(configPath)
      : {};
    
    // Allow environment variable overrides
    const finalConfig = {
      maxEntries: parseInt(process.env.MAX_ENTRIES as string) || config.maxEntries,
      maxMemory: parseInt(process.env.MAX_MEMORY as string) || config.maxMemory,
      defaultTTL: parseInt(process.env.DEFAULT_TTL as string) || config.defaultTTL,
      checkInterval: parseInt(process.env.CHECK_INTERVAL as string) || config.checkInterval,
      statsInterval: parseInt(process.env.STATS_INTERVAL as string) || config.statsInterval,
      versionAwareMode: process.env.VERSION_AWARE_MODE === 'true' || config.versionAwareMode || false
    };

    this.server = new Server(
      {
        name: 'charly-memory-cache-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.cacheManager = new CacheManager(finalConfig);

    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.close();
      process.exit(0);
    });
  }

  private setupResourceHandlers() {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'cache://stats',
          name: 'Cache Statistics',
          mimeType: 'application/json',
          description: 'Real-time cache performance metrics',
        },
      ],
    }));

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (request.params.uri === 'cache://stats') {
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'application/json',
              text: JSON.stringify(this.cacheManager.getStats(), null, 2),
            },
          ],
        };
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource: ${request.params.uri}`
      );
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'store_data',
          description: 'Store data in the cache with optional TTL',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Unique identifier for the cached data',
              },
              value: {
                description: 'Data to cache',
              },
              ttl: {
                type: 'number',
                description: 'Time-to-live in seconds (optional)',
              },
            },
            required: ['key', 'value'],
          },
        },
        {
          name: 'retrieve_data',
          description: 'Retrieve data from the cache with optional freshness validation',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key of the cached data to retrieve',
              },
              validateFreshness: {
                type: 'boolean',
                description: 'Whether to validate file timestamps and content hash (default: false)',
              },
            },
            required: ['key'],
          },
        },
        {
          name: 'clear_cache',
          description: 'Clear specific or all cache entries',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Specific key to clear (optional - clears all if not provided)',
              },
            },
          },
        },
        {
          name: 'get_cache_stats',
          description: 'Get cache statistics',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'store_data_with_version',
          description: 'Store data with version awareness and dependency tracking',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Unique identifier for the cached data',
              },
              value: {
                description: 'Data to cache',
              },
              ttl: {
                type: 'number',
                description: 'Time-to-live in seconds (optional)',
              },
              version: {
                type: 'string',
                description: 'Version identifier (optional, uses timestamp if not provided)',
              },
              dependencies: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'List of dependent file paths (optional)',
              },
              sourceFile: {
                type: 'string',
                description: 'Source file path for dependency tracking (optional)',
              },
            },
            required: ['key', 'value'],
          },
        },
        {
          name: 'retrieve_data_with_validation',
          description: 'Retrieve data with version validation and dependency checking',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key of the cached data to retrieve',
              },
              version: {
                type: 'string',
                description: 'Specific version to retrieve (optional)',
              },
              validateDependencies: {
                type: 'boolean',
                description: 'Whether to validate dependencies (default: true)',
              },
            },
            required: ['key'],
          },
        },
        {
          name: 'get_version_stats',
          description: 'Get version management statistics',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'check_version_conflicts',
          description: 'Check for version conflicts in cached data',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key to check for conflicts (optional, checks all if not provided)',
              },
            },
          },
        },
        {
          name: 'batch_store_data',
          description: 'Store multiple data items in the cache with optional TTL',
          inputSchema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: {
                      type: 'string',
                      description: 'Unique identifier for the cached data',
                    },
                    value: {
                      description: 'Data to cache',
                    },
                    ttl: {
                      type: 'number',
                      description: 'Time-to-live in seconds (optional)',
                    },
                    version: {
                      type: 'string',
                      description: 'Version identifier (optional, uses timestamp if not provided)',
                    },
                    dependencies: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                      description: 'List of dependent file paths (optional)',
                    },
                    sourceFile: {
                      type: 'string',
                      description: 'Source file path for dependency tracking (optional)',
                    },
                  },
                  required: ['key', 'value'],
                },
                description: 'Array of items to store in cache',
              },
            },
            required: ['items'],
          },
        },
        {
          name: 'batch_retrieve_data',
          description: 'Retrieve multiple data items from the cache',
          inputSchema: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of keys to retrieve',
              },
              version: {
                type: 'string',
                description: 'Specific version to retrieve (optional)',
              },
              validateDependencies: {
                type: 'boolean',
                description: 'Whether to validate dependencies (default: true)',
              },
            },
            required: ['keys'],
          },
        },
        {
          name: 'batch_delete_data',
          description: 'Delete multiple cache entries',
          inputSchema: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of keys to delete',
              },
            },
            required: ['keys'],
          },
        },
        {
          name: 'get_hot_keys',
          description: 'Get list of hot keys (frequently accessed keys)',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of hot keys to return (default: 10)',
              },
              minAccess: {
                type: 'number',
                description: 'Minimum access count threshold (default: 5)',
              },
            },
          },
        },
        {
          name: 'preheat_keys',
          description: 'Preheat specified keys in the cache',
          inputSchema: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of keys to preheat',
              },
              data: {
                type: 'object',
                description: 'Optional preheating data as key-value pairs',
              },
            },
            required: ['keys'],
          },
        },
        {
          name: 'get_preheating_stats',
          description: 'Get cache preheating statistics',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_with_protection',
          description: 'Get data with cache penetration protection',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key of the cached data to retrieve',
              },
              validateDependencies: {
                type: 'boolean',
                description: 'Whether to validate dependencies (default: false)',
              },
            },
            required: ['key'],
          },
        },
        {
          name: 'clear_null_value_cache',
          description: 'Clear null value cache entries',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Specific key to clear from null cache (optional - clears all if not provided)',
              },
            },
          },
        },
        {
          name: 'get_penetration_stats',
          description: 'Get cache penetration protection statistics',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'store_data': {
            const validation = validateStoreArgs(request.params.arguments);
            if (!validation.isValid) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `输入验证失败: ${formatValidationErrors(validation.errors)}`
              );
            }

            const { key, value, ttl } = request.params.arguments as {
              key: string;
              value: any;
              ttl?: number;
            };
            await this.cacheManager.set(key, value, ttl);
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully stored data with key: ${key}`,
                },
              ],
            };
          }

          case 'retrieve_data': {
            const validation = validateRetrieveArgs(request.params.arguments);
            if (!validation.isValid) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `输入验证失败: ${formatValidationErrors(validation.errors)}`
              );
            }

            const { key, validateFreshness } = request.params.arguments as { 
              key: string; 
              validateFreshness?: boolean 
            };
            
            // 如果启用新鲜度验证，使用版本感知模式的get方法
            const value = validateFreshness && this.cacheManager.isVersionAware()
              ? await this.cacheManager.get(key, { validateDependencies: true })
              : await this.cacheManager.get(key);
            if (value === undefined) {
              const errorMsg = validateFreshness 
                ? `No valid data found for key: ${key} (may be expired, file changed, or content outdated)`
                : `No data found for key: ${key}`;
              return {
                content: [
                  {
                    type: 'text',
                    text: errorMsg,
                  },
                ],
                isError: true,
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(value, null, 2),
                },
              ],
            };
          }

          case 'clear_cache': {
            const validation = validateClearArgs(request.params.arguments);
            if (!validation.isValid) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `输入验证失败: ${formatValidationErrors(validation.errors)}`
              );
            }

            const { key } = request.params.arguments as { key?: string };
            if (key) {
              const success = await this.cacheManager.delete(key);
              return {
                content: [
                  {
                    type: 'text',
                    text: success
                      ? `Successfully cleared cache entry: ${key}`
                      : `No cache entry found for key: ${key}`,
                  },
                ],
              };
            } else {
              await this.cacheManager.clear();
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Successfully cleared all cache entries',
                  },
                ],
              };
            }
          }

          case 'get_cache_stats': {
            const stats = this.cacheManager.getStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(stats, null, 2),
                },
              ],
            };
          }

          case 'store_data_with_version': {
            const { key, value, ttl, version, dependencies, sourceFile } = request.params.arguments as {
              key: string;
              value: any;
              ttl?: number;
              version?: string;
              dependencies?: string[];
              sourceFile?: string;
            };
            
            if (!this.cacheManager.isVersionAware()) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Version-aware mode is not enabled. Set VERSION_AWARE_MODE=true or configure versionAwareMode in config.json',
                  },
                ],
                isError: true,
              };
            }
            
            await this.cacheManager.set(key, value, ttl, { version, dependencies, sourceFile });
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully stored data with version awareness for key: ${key}`,
                },
              ],
            };
          }

          case 'retrieve_data_with_validation': {
            const { key, version, validateDependencies } = request.params.arguments as {
              key: string;
              version?: string;
              validateDependencies?: boolean;
            };
            
            if (!this.cacheManager.isVersionAware()) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Version-aware mode is not enabled. Set VERSION_AWARE_MODE=true or configure versionAwareMode in config.json',
                  },
                ],
                isError: true,
              };
            }
            
            const value = await this.cacheManager.get(key, { version, validateDependencies });
            if (value === undefined) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `No valid data found for key: ${key} (may be expired or dependencies changed)`,
                  },
                ],
                isError: true,
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(value, null, 2),
                },
              ],
            };
          }

          case 'get_version_stats': {
            if (!this.cacheManager.isVersionAware()) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Version-aware mode is not enabled',
                  },
                ],
              };
            }
            
            const versionStats = this.cacheManager.getVersionStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(versionStats, null, 2),
                },
              ],
            };
          }

          case 'check_version_conflicts': {
            if (!this.cacheManager.isVersionAware()) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Version-aware mode is not enabled',
                  },
                ],
              };
            }
            
            const { key } = request.params.arguments as { key?: string };
            const conflicts = await this.checkVersionConflicts(key);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(conflicts, null, 2),
                },
              ],
            };
          }

          case 'batch_store_data': {
            const { items } = request.params.arguments as { items: Array<{
              key: string;
              value: any;
              ttl?: number;
              version?: string;
              dependencies?: string[];
              sourceFile?: string;
            }>};

            if (!Array.isArray(items) || items.length === 0) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Items must be a non-empty array'
              );
            }

            const processedItems = items.map(item => ({
              key: item.key,
              value: item.value,
              ttl: item.ttl,
              options: {
                version: item.version,
                dependencies: item.dependencies,
                sourceFile: item.sourceFile
              }
            }));

            const result = await (this.cacheManager as any).setMany(processedItems);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Batch store completed: ${result.success.length} succeeded, ${result.failed.length} failed`,
                    success: result.success,
                    failed: result.failed
                  }, null, 2),
                },
              ],
            };
          }

          case 'batch_retrieve_data': {
            const { keys, version, validateDependencies } = request.params.arguments as {
              keys: string[];
              version?: string;
              validateDependencies?: boolean;
            };

            if (!Array.isArray(keys) || keys.length === 0) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Keys must be a non-empty array'
              );
            }

            const result = await (this.cacheManager as any).getMany(keys, { version, validateDependencies });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Batch retrieve completed: ${result.found.length} found, ${result.missing.length} missing`,
                    found: result.found,
                    missing: result.missing
                  }, null, 2),
                },
              ],
            };
          }

          case 'batch_delete_data': {
            const { keys } = request.params.arguments as { keys: string[] };

            if (!Array.isArray(keys) || keys.length === 0) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Keys must be a non-empty array'
              );
            }

            const result = await (this.cacheManager as any).deleteMany(keys);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Batch delete completed: ${result.success.length} succeeded, ${result.failed.length} failed`,
                    success: result.success,
                    failed: result.failed
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_hot_keys': {
            const { limit, minAccess } = request.params.arguments as {
              limit?: number;
              minAccess?: number;
            };

            const hotKeys = (this.cacheManager as any).getHotKeys(limit, minAccess);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    hotKeys,
                    count: hotKeys.length,
                    parameters: { limit: limit || 10, minAccess: minAccess || 5 }
                  }, null, 2),
                },
              ],
            };
          }

          case 'preheat_keys': {
            const { keys, data } = request.params.arguments as {
              keys: string[];
              data?: Record<string, any>;
            };

            if (!Array.isArray(keys) || keys.length === 0) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Keys must be a non-empty array'
              );
            }

            // 转换数据格式
            const preheatingData = data ? new Map(Object.entries(data)) : undefined;
            const result = await (this.cacheManager as any).preheatKeys(keys, preheatingData);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Preheating completed: ${result.success.length} preheated, ${result.alreadyCached.length} already cached, ${result.failed.length} failed`,
                    success: result.success,
                    alreadyCached: result.alreadyCached,
                    failed: result.failed
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_preheating_stats': {
            const stats = (this.cacheManager as any).getPreheatingStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(stats, null, 2),
                },
              ],
            };
          }

          case 'get_with_protection': {
            const { key, validateDependencies } = request.params.arguments as {
              key: string;
              validateDependencies?: boolean;
            };

            // 注意：这里需要一个数据加载器函数，但在MCP工具中我们无法提供
            // 所以这个工具主要是为了演示和测试，实际使用中需要客户端直接调用getWithProtection方法
            return {
              content: [
                {
                  type: 'text',
                  text: 'get_with_protection tool requires a data loader function. This tool is for demonstration purposes. Use the CacheManager.getWithProtection method directly in your code with a data loader function.',
                },
              ],
            };
          }

          case 'clear_null_value_cache': {
            const { key } = request.params.arguments as { key?: string };
            
            (this.cacheManager as any).clearNullValueCache(key);
            return {
              content: [
                {
                  type: 'text',
                  text: key 
                    ? `Successfully cleared null value cache for key: ${key}`
                    : 'Successfully cleared all null value cache entries',
                },
              ],
            };
          }

          case 'get_penetration_stats': {
            const stats = (this.cacheManager as any).getCachePenetrationStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(stats, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Memory Cache MCP server running on stdio');
  }

  async close() {
    await this.cacheManager.destroy();
    await this.server.close();
  }
  
  /**
   * 检查版本冲突
   */
  private async checkVersionConflicts(key?: string): Promise<{
    conflicts: Array<{
      key: string;
      versions: string[];
      status: 'conflict' | 'ok';
    }>;
    totalChecked: number;
  }> {
    const conflicts: Array<{
      key: string;
      versions: string[];
      status: 'conflict' | 'ok';
    }> = [];
    
    // 获取所有缓存键的版本信息
    const versionMap = new Map<string, Set<string>>();
    
    for (const cacheKey of (this.cacheManager as any).cache.keys()) {
      if (cacheKey.includes('@')) {
        const [baseKey, version] = cacheKey.split('@');
        
        if (!key || baseKey === key) {
          if (!versionMap.has(baseKey)) {
            versionMap.set(baseKey, new Set());
          }
          versionMap.get(baseKey)!.add(version);
        }
      }
    }
    
    // 检查每个键的版本冲突
    for (const [baseKey, versions] of versionMap.entries()) {
      const versionArray = Array.from(versions);
      const status = versionArray.length > 1 ? 'conflict' : 'ok';
      
      conflicts.push({
        key: baseKey,
        versions: versionArray,
        status
      });
    }
    
    return {
      conflicts,
      totalChecked: versionMap.size
    };
  }
}

const server = new MemoryCacheServer();
server.run().catch(console.error);
