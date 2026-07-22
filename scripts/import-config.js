// 产品导入配置文件
// 针对130000条数据的优化配置

module.exports = {
  // 数据库连接配置
  database: {
    connectionString: process.env.DATABASE_URL,
    maxConnections: 20, // 增加连接数
    idleTimeoutMillis: 60000, // 增加空闲超时
    connectionTimeoutMillis: 5000, // 增加连接超时
  },

  // 导入配置
  import: {
    batchSize: 2000, // 每批2000条，平衡性能和内存
    delayBetweenBatches: 50, // 批次间延迟50ms，减少数据库压力
    maxRetries: 5, // 增加重试次数
    logProgress: true, // 记录进度
    progressInterval: 5000, // 每5000条记录一次进度
  },

  // 性能优化配置
  performance: {
    enableParallelProcessing: false, // 暂时禁用并行处理，避免锁冲突
    memoryLimit: "1GB", // 内存限制
    enableCompression: true, // 启用数据压缩
  },

  // 错误处理配置
  errorHandling: {
    continueOnError: true, // 遇到错误继续处理
    maxErrors: 1000, // 最大错误数量
    saveErrorReport: true, // 保存错误报告
  },

  // 监控配置
  monitoring: {
    enableMetrics: true, // 启用性能指标
    logMemoryUsage: true, // 记录内存使用
    logDatabaseStats: true, // 记录数据库统计
  },
};
