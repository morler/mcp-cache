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
import { ErrorHandler, CacheError, CacheErrorCode } from './errorHandler.js';
import { globalMonitoring, MonitoringManager, DashboardData, Alert, AlertRule, PerformanceTrend } from './monitoring.js';
import { globalConfigManager, ConfigManager, ConfigProfile, ConfigChangeEvent, AutoTuneConfig } from './configManager.js';
import fs from 'fs-extra';
import path from 'path';

class MemoryCacheServer {
  private server: Server;
  private cacheManager: CacheManager;
  
  // MCP服务器性能优化
  private requestQueue: Array<{ request: any; resolve: Function; reject: Function }> = [];
  private isProcessingQueue: boolean = false;
  private batchSize: number = 50;
  private processingDelay: number = 10; // ms
  private monitoringManager!: MonitoringManager;
  private configManager!: ConfigManager;
  private requestStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgResponseTime: 0,
    batchedRequests: 0
  };

  constructor() {
    // Load configuration
    const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.json');
    const config = fs.existsSync(configPath) 
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
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
    
    // 初始化监控系统
    console.log('初始化监控系统...');
    this.monitoringManager = globalMonitoring;
    
    // 初始化配置管理器
    console.log('初始化配置管理器...');
    this.configManager = globalConfigManager;
    
    // 设置配置变更监听器
    this.configManager.addChangeListener((config, changes) => {
      console.log('配置已更新:', changes.changes.map(c => c.field).join(', '));
      // 这里可以根据需要重新初始化相关组件
    });

    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.close();
      process.exit(0);
    });
    
    // 启动请求队列处理器
    this.startRequestProcessor();
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
        {
          uri: 'monitoring://metrics',
          name: 'Monitoring Metrics',
          mimeType: 'application/json',
          description: 'Real-time monitoring and performance metrics',
        },
        {
          uri: 'monitoring://dashboard',
          name: 'Monitoring Dashboard',
          mimeType: 'application/json',
          description: 'Comprehensive dashboard data for monitoring',
        },
        {
          uri: 'monitoring://alerts',
          name: 'Active Alerts',
          mimeType: 'application/json',
          description: 'Currently active monitoring alerts',
        },
        {
          uri: 'monitoring://health',
          name: 'System Health',
          mimeType: 'application/json',
          description: 'Overall system health status',
        },
      ],
    }));

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      
      switch (uri) {
        case 'cache://stats':
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.cacheManager.getStats(), null, 2),
              },
            ],
          };
          
        case 'monitoring://metrics':
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.monitoringManager.getCurrentMetrics(), null, 2),
              },
            ],
          };
          
        case 'monitoring://dashboard':
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.monitoringManager.getDashboardData(), null, 2),
              },
            ],
          };
          
        case 'monitoring://alerts':
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.monitoringManager.getActiveAlerts(), null, 2),
              },
            ],
          };
          
        case 'monitoring://health':
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.monitoringManager.getSystemHealth(), null, 2),
              },
            ],
          };
          
        default:
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${request.params.uri}`
          );
      }
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
        {
          name: 'get_gc_stats',
          description: 'Get garbage collection statistics and memory pressure information',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'force_gc',
          description: 'Manually trigger garbage collection',
          inputSchema: {
            type: 'object',
            properties: {
              aggressive: {
                type: 'boolean',
                description: 'Whether to perform aggressive (full) garbage collection (default: false)',
              },
            },
          },
        },
        {
          name: 'set_memory_pressure_thresholds',
          description: 'Configure memory pressure level thresholds',
          inputSchema: {
            type: 'object',
            properties: {
              low: {
                type: 'number',
                description: 'Low pressure threshold (0.0-1.0, e.g., 0.5 for 50%)',
                minimum: 0,
                maximum: 1,
              },
              medium: {
                type: 'number',
                description: 'Medium pressure threshold (0.0-1.0, e.g., 0.7 for 70%)',
                minimum: 0,
                maximum: 1,
              },
              high: {
                type: 'number',
                description: 'High pressure threshold (0.0-1.0, e.g., 0.85 for 85%)',
                minimum: 0,
                maximum: 1,
              },
              critical: {
                type: 'number',
                description: 'Critical pressure threshold (0.0-1.0, e.g., 0.95 for 95%)',
                minimum: 0,
                maximum: 1,
              },
            },
          },
        },
        {
          name: 'get_server_stats',
          description: 'Get MCP server performance statistics',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_error_stats',
          description: 'Get error handling statistics and logs',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Number of recent errors to include (default: 10)',
                minimum: 1,
                maximum: 100,
              },
            },
          },
        },
        {
          name: 'get_system_health',
          description: 'Get overall system health status including circuit breakers',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'reset_circuit_breakers',
          description: 'Reset all circuit breakers to closed state',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Specific circuit breaker name to reset (optional - resets all if not provided)',
              },
            },
          },
        },
        {
          name: 'execute_recovery_strategy',
          description: 'Manually execute recovery strategy for a specific error type',
          inputSchema: {
            type: 'object',
            properties: {
              errorCode: {
                type: 'number',
                description: 'Error code to recover from',
              },
              context: {
                type: 'object',
                description: 'Additional context for recovery (optional)',
              },
            },
            required: ['errorCode'],
          },
        },
        // ==== 监控相关工具 ====
        {
          name: 'get_monitoring_metrics',
          description: 'Get current monitoring metrics',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_metrics_history',
          description: 'Get historical monitoring metrics',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Limit the number of records returned (optional)',
              },
            },
            required: [],
          },
        },
        {
          name: 'get_performance_trends',
          description: 'Get performance trend analysis',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_dashboard_data',
          description: 'Get comprehensive dashboard data for monitoring',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_active_alerts',
          description: 'Get currently active alerts',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_alert_history',
          description: 'Get alert history',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Limit the number of records returned (optional)',
              },
            },
            required: [],
          },
        },
        {
          name: 'add_alert_rule',
          description: 'Add a new alert rule',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique identifier for the alert rule',
              },
              name: {
                type: 'string',
                description: 'Human-readable name for the alert rule',
              },
              condition: {
                type: 'object',
                description: 'Alert condition specification',
                properties: {
                  metric: { type: 'string' },
                  operator: { type: 'string', enum: ['>', '<', '>=', '<=', '==', '!='] },
                  threshold: { type: 'number' }
                },
                required: ['metric', 'operator', 'threshold']
              },
              severity: {
                type: 'string',
                enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
                description: 'Alert severity level',
              },
              enabled: {
                type: 'boolean',
                description: 'Whether the alert rule is enabled',
              },
              cooldownMs: {
                type: 'number',
                description: 'Cooldown period in milliseconds',
              },
              description: {
                type: 'string',
                description: 'Description of the alert rule',
              },
            },
            required: ['id', 'name', 'condition', 'severity', 'enabled', 'cooldownMs', 'description'],
          },
        },
        {
          name: 'remove_alert_rule',
          description: 'Remove an existing alert rule',
          inputSchema: {
            type: 'object',
            properties: {
              ruleId: {
                type: 'string',
                description: 'ID of the alert rule to remove',
              },
            },
            required: ['ruleId'],
          },
        },
        {
          name: 'get_alert_rules',
          description: 'Get all alert rules',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'resolve_alert',
          description: 'Resolve an active alert',
          inputSchema: {
            type: 'object',
            properties: {
              alertId: {
                type: 'string',
                description: 'ID of the alert to resolve',
              },
            },
            required: ['alertId'],
          },
        },
        {
          name: 'get_monitoring_health',
          description: 'Get overall system health status',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'reset_monitoring_stats',
          description: 'Reset all monitoring statistics',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      this.requestStats.totalRequests++;
      
      try {
        // 对于高频操作使用批处理优化
        if (this.shouldUseBatchProcessing(request.params.name)) {
          return await this.processBatchedRequest(request);
        }
        
        const result = await this.processToolRequest(request);
        
        // 更新响应时间统计
        const responseTime = Date.now() - startTime;
        this.updateResponseTimeStats(responseTime);
        this.requestStats.successfulRequests++;
        
        // 记录监控数据
        this.monitoringManager.recordRequest(true, responseTime);
        
        return result;
      } catch (error) {
        this.requestStats.failedRequests++;
        
        // 记录监控数据
        const responseTime = Date.now() - startTime;
        this.monitoringManager.recordRequest(false, responseTime);
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
  
  /**
   * 判断是否应该使用批处理
   */
  private shouldUseBatchProcessing(toolName: string): boolean {
    const batchableTools = [
      'batch_store_data',
      'batch_retrieve_data', 
      'batch_delete_data'
    ];
    return batchableTools.includes(toolName);
  }
  
  /**
   * 处理批处理请求
   */
  private async processBatchedRequest(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ request, resolve, reject });
      
      // 如果队列未在处理中，启动处理
      if (!this.isProcessingQueue) {
        this.processRequestQueue();
      }
    });
  }
  
  /**
   * 启动请求处理器
   */
  private startRequestProcessor(): void {
    setInterval(() => {
      if (this.requestQueue.length > 0 && !this.isProcessingQueue) {
        this.processRequestQueue();
      }
    }, this.processingDelay);
  }
  
  /**
   * 处理请求队列
   */
  private async processRequestQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    // 批量处理请求
    const batch = this.requestQueue.splice(0, Math.min(this.batchSize, this.requestQueue.length));
    this.requestStats.batchedRequests += batch.length;
    
    // 按工具类型分组处理
    const groupedRequests = new Map<string, typeof batch>();
    for (const item of batch) {
      const toolName = item.request.params.name;
      if (!groupedRequests.has(toolName)) {
        groupedRequests.set(toolName, []);
      }
      groupedRequests.get(toolName)!.push(item);
    }
    
    // 并行处理每个分组
    const processingPromises = Array.from(groupedRequests.entries()).map(async ([toolName, requests]) => {
      for (const { request, resolve, reject } of requests) {
        try {
          const result = await this.processToolRequest(request);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }
    });
    
    await Promise.all(processingPromises);
    this.isProcessingQueue = false;
  }
  
  /**
   * 处理单个工具请求
   */
  private async processToolRequest(request: any): Promise<any> {
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
            
            // 记录缓存操作
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
              // 记录缓存miss
              this.monitoringManager.recordCacheOperation('miss');
              
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
            
            // 记录缓存hit
            this.monitoringManager.recordCacheOperation('hit');
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

          case 'get_gc_stats': {
            const gcStats = (this.cacheManager as any).getGCStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Garbage collection and memory pressure statistics',
                    ...gcStats
                  }, null, 2),
                },
              ],
            };
          }

          case 'force_gc': {
            const { aggressive } = request.params.arguments as {
              aggressive?: boolean;
            };

            const result = await (this.cacheManager as any).forceGC(aggressive || false);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Garbage collection completed (${aggressive ? 'aggressive' : 'smart'} mode)`,
                    ...result
                  }, null, 2),
                },
              ],
            };
          }

          case 'set_memory_pressure_thresholds': {
            const { low, medium, high, critical } = request.params.arguments as {
              low?: number;
              medium?: number;
              high?: number;
              critical?: number;
            };

            // 验证阈值的逻辑顺序
            const thresholds = { low, medium, high, critical };
            const definedThresholds = Object.entries(thresholds)
              .filter(([_, value]) => value !== undefined)
              .sort((a, b) => a[1]! - b[1]!);
            
            if (definedThresholds.length > 1) {
              for (let i = 1; i < definedThresholds.length; i++) {
                if (definedThresholds[i][1]! <= definedThresholds[i-1][1]!) {
                  throw new McpError(
                    ErrorCode.InvalidParams,
                    `Memory pressure thresholds must be in ascending order: ${definedThresholds[i-1][0]} (${definedThresholds[i-1][1]}) >= ${definedThresholds[i][0]} (${definedThresholds[i][1]})`
                  );
                }
              }
            }

            (this.cacheManager as any).setMemoryPressureThresholds(thresholds);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Memory pressure thresholds updated successfully',
                    updatedThresholds: Object.fromEntries(
                      Object.entries(thresholds).filter(([_, value]) => value !== undefined)
                    )
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_server_stats': {
            const serverStats = this.getRequestStats();
            const cacheStats = this.cacheManager.getStats();
            const gcStats = (this.cacheManager as any).getGCStats();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'MCP Server comprehensive performance statistics',
                    server: serverStats,
                    cache: cacheStats,
                    garbageCollection: gcStats
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_error_stats': {
            const { limit } = request.params.arguments as { limit?: number };
            const errorHandler = ErrorHandler.getInstance();
            const errorStats = errorHandler.getErrorStats();
            const recentErrors = errorHandler.getErrorLog(limit || 10);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Error handling statistics',
                    statistics: errorStats,
                    recentErrors: recentErrors,
                    circuitBreakers: errorHandler.getAllCircuitBreakerStats()
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_system_health': {
            const errorHandler = ErrorHandler.getInstance();
            const systemHealth = errorHandler.getSystemHealth();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'System health status',
                    ...systemHealth
                  }, null, 2),
                },
              ],
            };
          }

          case 'reset_circuit_breakers': {
            const { name } = request.params.arguments as { name?: string };
            const errorHandler = ErrorHandler.getInstance();
            
            if (name) {
              const breaker = errorHandler.getCircuitBreaker(name);
              breaker.reset();
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      message: `Circuit breaker '${name}' has been reset successfully`,
                      name: name
                    }, null, 2),
                  },
                ],
              };
            } else {
              errorHandler.resetAllCircuitBreakers();
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      message: 'All circuit breakers have been reset successfully'
                    }, null, 2),
                  },
                ],
              };
            }
          }

          case 'execute_recovery_strategy': {
            const { errorCode, context } = request.params.arguments as {
              errorCode: number;
              context?: Record<string, any>;
            };
            
            const errorHandler = ErrorHandler.getInstance();
            const success = await errorHandler.executeRecoveryStrategy(errorCode, context);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Recovery strategy execution ${success ? 'successful' : 'failed'}`,
                    errorCode: errorCode,
                    success: success,
                    context: context
                  }, null, 2),
                },
              ],
            };
          }

          // ==== 监控相关工具 ====

          case 'get_monitoring_metrics': {
            const currentMetrics = this.monitoringManager.getCurrentMetrics();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Current monitoring metrics retrieved',
                    metrics: currentMetrics
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_metrics_history': {
            const { limit } = request.params.arguments as { limit?: number };
            const history = this.monitoringManager.getMetricsHistory(limit);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Retrieved ${history.length} metrics records`,
                    history
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_performance_trends': {
            const trends = this.monitoringManager.getPerformanceTrends();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Performance trends retrieved',
                    trends
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_dashboard_data': {
            const dashboardData = this.monitoringManager.getDashboardData();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Dashboard data retrieved',
                    dashboard: dashboardData
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_active_alerts': {
            const alerts = this.monitoringManager.getActiveAlerts();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Retrieved ${alerts.length} active alerts`,
                    alerts
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_alert_history': {
            const { limit } = request.params.arguments as { limit?: number };
            const history = this.monitoringManager.getAlertHistory(limit);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Retrieved ${history.length} alert records`,
                    history
                  }, null, 2),
                },
              ],
            };
          }

          case 'add_alert_rule': {
            const rule = request.params.arguments as AlertRule;
            
            if (!rule.id || !rule.name || !rule.condition) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Alert rule must have id, name, and condition'
              );
            }
            
            this.monitoringManager.addAlertRule(rule);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Alert rule added successfully',
                    rule
                  }, null, 2),
                },
              ],
            };
          }

          case 'remove_alert_rule': {
            const { ruleId } = request.params.arguments as { ruleId: string };
            
            if (!ruleId) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Rule ID is required'
              );
            }
            
            const success = this.monitoringManager.removeAlertRule(ruleId);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: success ? 'Alert rule removed successfully' : 'Alert rule not found',
                    success,
                    ruleId
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_alert_rules': {
            const rules = this.monitoringManager.getAlertRules();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Retrieved ${rules.length} alert rules`,
                    rules
                  }, null, 2),
                },
              ],
            };
          }

          case 'resolve_alert': {
            const { alertId } = request.params.arguments as { alertId: string };
            
            if (!alertId) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Alert ID is required'
              );
            }
            
            const success = this.monitoringManager.resolveAlert(alertId);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: success ? 'Alert resolved successfully' : 'Alert not found or already resolved',
                    success,
                    alertId
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_monitoring_health': {
            const health = this.monitoringManager.getSystemHealth();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'System health status retrieved',
                    health
                  }, null, 2),
                },
              ],
            };
          }

          case 'reset_monitoring_stats': {
            this.monitoringManager.reset();
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Monitoring statistics reset successfully'
                  }, null, 2),
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
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Memory Cache MCP server running on stdio');
  }

  async close() {
    console.log('正在关闭MCP服务器...');
    console.log('请求统计:', this.getRequestStats());
    
    // 等待队列处理完成
    while (this.requestQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await this.cacheManager.destroy();
    await this.server.close();
    console.log('MCP服务器已关闭');
  }
  
  /**
   * 更新响应时间统计
   */
  private updateResponseTimeStats(responseTime: number): void {
    const currentAvg = this.requestStats.avgResponseTime;
    const totalSuccessful = this.requestStats.successfulRequests;
    
    // 计算移动平均值
    this.requestStats.avgResponseTime = totalSuccessful === 1 
      ? responseTime
      : (currentAvg * (totalSuccessful - 1) + responseTime) / totalSuccessful;
  }
  
  /**
   * 获取请求统计信息
   */
  getRequestStats(): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgResponseTime: number;
    batchedRequests: number;
    successRate: string;
  } {
    const successRate = this.requestStats.totalRequests > 0 
      ? (this.requestStats.successfulRequests / this.requestStats.totalRequests * 100).toFixed(2)
      : '0.00';
    
    return {
      ...this.requestStats,
      avgResponseTime: Math.round(this.requestStats.avgResponseTime * 100) / 100,
      successRate: `${successRate}%`
    };
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
