const fs = require('fs');
const path = require('path');

// 日志级别枚举
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

// 日志级别名称映射
const LogLevelNames = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR'
};

// 日志配置
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE_PREFIX = 'app';
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 10; // 保留最近10个日志文件

// 确保日志目录存在
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// 获取当前日志文件路径
const getLogFilePath = () => {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `${LOG_FILE_PREFIX}-${dateStr}.log`);
};

// 格式化日期时间
const formatDateTime = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
};

// 清理旧日志文件
const cleanupOldLogs = () => {
  try {
    const files = fs.readdirSync(LOGS_DIR)
      .filter(file => file.startsWith(LOG_FILE_PREFIX) && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(LOGS_DIR, file),
        stat: fs.statSync(path.join(LOGS_DIR, file))
      }))
      .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime()); // 按修改时间倒序

    // 删除超出数量限制的旧日志
    if (files.length > MAX_LOG_FILES) {
      const filesToDelete = files.slice(MAX_LOG_FILES);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file.path);
          console.log(`已删除旧日志文件: ${file.name}`);
        } catch (error) {
          console.error(`删除旧日志文件失败 ${file.name}:`, error);
        }
      });
    }
  } catch (error) {
    console.error('清理旧日志文件时出错:', error);
  }
};

// 日志写入队列（避免并发写入问题）
const logQueue = [];
let isWriting = false;

// 内存中的日志缓存（用于查询最近的日志）
const logCache = [];
const MAX_LOG_CACHE_SIZE = 500; // 最多缓存500条日志

// 写入日志到文件
const writeToFile = async (message) => {
  logQueue.push(message);
  
  if (isWriting) {
    return;
  }
  
  isWriting = true;
  
  while (logQueue.length > 0) {
    const msg = logQueue.shift();
    const logFile = getLogFilePath();
    
    try {
      // 检查文件大小
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > MAX_LOG_FILE_SIZE) {
          // 文件过大，重命名为带时间戳的文件
          const timestamp = Date.now();
          const oldFile = logFile.replace('.log', `-${timestamp}.log`);
          fs.renameSync(logFile, oldFile);
          // 清空缓存（文件已轮转）
          logCache.length = 0;
        }
      }
      
      // 追加写入日志
      fs.appendFileSync(logFile, msg + '\n', 'utf8');
      
      // 添加到缓存
      logCache.push({
        message: msg,
        timestamp: Date.now()
      });
      
      // 限制缓存大小
      if (logCache.length > MAX_LOG_CACHE_SIZE) {
        logCache.shift();
      }
    } catch (error) {
      // 如果写入失败，至少输出到控制台
      console.error('写入日志文件失败:', error);
      console.error('原始日志消息:', msg);
    }
  }
  
  isWriting = false;
};

// 获取调用堆栈信息（用于显示日志来源）
const getCallerInfo = () => {
  const stack = new Error().stack;
  if (!stack) return '';
  
  const stackLines = stack.split('\n');
  // 跳过前3行：Error对象、getCallerInfo、logger方法
  if (stackLines.length > 4) {
    const callerLine = stackLines[4].trim();
    // 提取文件名和行号
    const match = callerLine.match(/\((.+):(\d+):(\d+)\)/);
    if (match) {
      const filePath = match[1];
      const fileName = path.basename(filePath);
      const lineNumber = match[2];
      return `${fileName}:${lineNumber}`;
    }
  }
  return '';
};

// 创建日志记录器类
class Logger {
  constructor(level = LogLevel.INFO, enableFileLog = true, enableConsoleLog = true) {
    this.level = level;
    this.enableFileLog = enableFileLog;
    this.enableConsoleLog = enableConsoleLog;
    
    // 定期清理旧日志（每小时一次）
    setInterval(cleanupOldLogs, 60 * 60 * 1000);
    // 启动时立即清理一次
    cleanupOldLogs();
  }

  setLevel(level) {
    this.level = level;
  }

  setEnableFileLog(enable) {
    this.enableFileLog = enable;
  }

  setEnableConsoleLog(enable) {
    this.enableConsoleLog = enable;
  }

  log(level, message, ...args) {
    if (level < this.level) {
      return;
    }

    const timestamp = formatDateTime();
    const levelName = LogLevelNames[level] || 'UNKNOWN';
    const callerInfo = getCallerInfo();
    const callerStr = callerInfo ? ` [${callerInfo}]` : '';
    
    // 格式化消息
    let formattedMessage = message;
    if (args.length > 0) {
      formattedMessage += ' ' + args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
    }

    const logMessage = `[${timestamp}] [${levelName}]${callerStr} ${formattedMessage}`;

    // 输出到控制台
    if (this.enableConsoleLog) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(logMessage);
          break;
        case LogLevel.INFO:
          console.log(logMessage);
          break;
        case LogLevel.WARN:
          console.warn(logMessage);
          break;
        case LogLevel.ERROR:
          console.error(logMessage);
          break;
      }
    }

    // 写入文件
    if (this.enableFileLog) {
      writeToFile(logMessage);
    }
  }

  debug(message, ...args) {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message, ...args) {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message, ...args) {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message, ...args) {
    this.log(LogLevel.ERROR, message, ...args);
  }

  // 记录 HTTP 请求
  httpRequest(req, res, responseTime) {
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;
    const level = statusCode >= 500 ? LogLevel.ERROR : 
                  statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO;
    this.log(level, `${method} ${originalUrl} - ${statusCode} - ${ip} - ${responseTime}ms`);
  }

  // 记录异常
  exception(error, context = '') {
    const message = context ? `${context}: ${error.message}` : error.message;
    const stack = error.stack || '';
    this.error(message);
    if (stack) {
      this.error('堆栈信息:', stack);
    }
  }

  // 获取缓存的日志
  getCachedLogs(limit = 100) {
    return logCache.slice(-limit).map(item => ({
      timestamp: new Date(item.timestamp).toISOString(),
      message: item.message
    }));
  }

  // 从文件读取日志
  readLogsFromFile(options = {}) {
    const {
      startDate,
      endDate,
      level,
      keyword,
      limit = 100
    } = options;

    try {
      const logFile = getLogFilePath();
      if (!fs.existsSync(logFile)) {
        return [];
      }

      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      let filtered = lines;

      // 按时间过滤
      if (startDate || endDate) {
        filtered = filtered.filter(line => {
          const match = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]/);
          if (!match) return true;
          const logTime = new Date(match[1]).getTime();
          if (startDate && logTime < startDate.getTime()) return false;
          if (endDate && logTime > endDate.getTime()) return false;
          return true;
        });
      }

      // 按级别过滤
      if (level !== undefined) {
        const levelName = LogLevelNames[level];
        filtered = filtered.filter(line => line.includes(`[${levelName}]`));
      }

      // 按关键字过滤
      if (keyword) {
        const keywordLower = keyword.toLowerCase();
        filtered = filtered.filter(line => line.toLowerCase().includes(keywordLower));
      }

      // 限制数量（返回最新的）
      return filtered.slice(-limit);
    } catch (error) {
      console.error('读取日志文件失败:', error);
      return [];
    }
  }

  // 获取日志统计信息
  getLogStats() {
    const stats = {
      cacheSize: logCache.length,
      logFile: getLogFilePath(),
      logFileExists: fs.existsSync(getLogFilePath()),
      logFileSize: 0,
      totalLogFiles: 0
    };

    try {
      const logFile = getLogFilePath();
      if (fs.existsSync(logFile)) {
        stats.logFileSize = fs.statSync(logFile).size;
      }

      // 统计日志文件数量
      const files = fs.readdirSync(LOGS_DIR)
        .filter(file => file.startsWith(LOG_FILE_PREFIX) && file.endsWith('.log'));
      stats.totalLogFiles = files.length;
    } catch (error) {
      // 忽略错误
    }

    return stats;
  }

  // 清空缓存
  clearCache() {
    logCache.length = 0;
  }
}

// 根据环境变量设置日志级别
const getLogLevelFromEnv = () => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  switch (envLevel) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'NONE':
      return LogLevel.NONE;
    default:
      return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
  }
};

// 创建默认日志实例
const logger = new Logger(
  getLogLevelFromEnv(),
  true, // 启用文件日志
  true  // 启用控制台日志
);

// 导出日志实例和类
module.exports = logger;
module.exports.Logger = Logger;
module.exports.LogLevel = LogLevel;
