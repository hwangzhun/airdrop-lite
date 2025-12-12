// 前端日志服务
// 主要用于开发环境调试，生产环境可以禁用或限制日志输出

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

const LogLevelNames = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR'
};

// 日志条目接口
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  message: string;
  callerInfo?: string;
  args?: any[];
  performance?: {
    duration?: number;
    label?: string;
  };
}

// 日志配置
const LOG_STORAGE_KEY = 'airdrop_lite_logs';
const MAX_LOG_ENTRIES = 1000; // 最多保存1000条日志
const LOG_PERSISTENCE_ENABLED = true;
const LOG_SEND_TO_BACKEND_ENABLED = true; // 是否发送日志到后端
const LOG_BATCH_SIZE = 10; // 批量发送日志的数量
const LOG_BATCH_INTERVAL = 5000; // 批量发送间隔（毫秒）

// 根据环境变量或配置获取日志级别
const getLogLevelFromEnv = (): LogLevel => {
  // 在生产环境默认只显示 WARN 和 ERROR
  if (import.meta.env.PROD) {
    return LogLevel.WARN;
  }
  // 开发环境显示所有日志
  return LogLevel.DEBUG;
};

// 从 localStorage 读取日志
const loadLogsFromStorage = (): LogEntry[] => {
  try {
    const stored = localStorage.getItem(LOG_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('读取日志失败:', error);
  }
  return [];
};

// 保存日志到 localStorage
const saveLogsToStorage = (logs: LogEntry[]) => {
  if (!LOG_PERSISTENCE_ENABLED) return;
  
  try {
    // 只保留最新的 MAX_LOG_ENTRIES 条
    const trimmedLogs = logs.slice(-MAX_LOG_ENTRIES);
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmedLogs));
  } catch (error) {
    console.warn('保存日志失败:', error);
    // 如果存储空间不足，尝试删除一些旧日志
    try {
      const trimmedLogs = logs.slice(-Math.floor(MAX_LOG_ENTRIES / 2));
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmedLogs));
    } catch (e) {
      console.error('清理日志后仍然保存失败:', e);
    }
  }
};

class Logger {
  private level: LogLevel;
  private enableConsoleLog: boolean;
  private enableBackendSync: boolean;
  private logs: LogEntry[] = [];
  private performanceMarks: Map<string, number> = new Map();
  private pendingLogs: LogEntry[] = [];
  private sendTimer: number | null = null;

  constructor(level?: LogLevel, enableConsoleLog = true, enableBackendSync = LOG_SEND_TO_BACKEND_ENABLED) {
    this.level = level ?? getLogLevelFromEnv();
    this.enableConsoleLog = enableConsoleLog;
    this.enableBackendSync = enableBackendSync;
    // 从存储加载历史日志
    this.logs = loadLogsFromStorage();
    // 启动批量发送定时器
    if (this.enableBackendSync) {
      this.startBatchSender();
    }
  }

  // 启动批量发送定时器
  private startBatchSender() {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
    }
    this.sendTimer = window.setInterval(() => {
      this.flushPendingLogs();
    }, LOG_BATCH_INTERVAL);
  }

  // 发送待处理的日志到后端
  private async flushPendingLogs() {
    if (this.pendingLogs.length === 0 || !this.enableBackendSync) {
      return;
    }

    const logsToSend = [...this.pendingLogs];
    this.pendingLogs = [];

    try {
      const API_HOST = import.meta.env.DEV ? 'http://localhost:3001' : '';
      const response = await fetch(`${API_HOST}/api/logs/frontend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ logs: logsToSend }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // 发送失败，将日志重新加入待发送队列（限制数量）
      this.pendingLogs = [...logsToSend, ...this.pendingLogs].slice(0, LOG_BATCH_SIZE * 2);
      // 静默失败，避免日志发送失败导致循环
    }
  }

  setEnableBackendSync(enable: boolean) {
    this.enableBackendSync = enable;
    if (enable) {
      this.startBatchSender();
    } else if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  setEnableConsoleLog(enable: boolean) {
    this.enableConsoleLog = enable;
  }

  private log(level: LogLevel, message: string, ...args: any[]) {
    if (level < this.level) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LogLevelNames[level] || 'UNKNOWN';
    const prefix = `[${timestamp}] [${levelName}]`;

    // 获取调用堆栈信息（简单版本）
    const stack = new Error().stack;
    let callerInfo = '';
    if (stack) {
      const stackLines = stack.split('\n');
      if (stackLines.length > 3) {
        const callerLine = stackLines[3].trim();
        const match = callerLine.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
          const fileName = match[2].split('/').pop() || match[2];
          const lineNumber = match[3];
          callerInfo = `${fileName}:${lineNumber}`;
        }
      }
    }

    const logMessage = `${prefix}${callerInfo ? ` [${callerInfo}]` : ''} ${message}`;

    // 输出到控制台
    if (this.enableConsoleLog) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(logMessage, ...args);
          break;
        case LogLevel.INFO:
          console.log(logMessage, ...args);
          break;
        case LogLevel.WARN:
          console.warn(logMessage, ...args);
          break;
        case LogLevel.ERROR:
          console.error(logMessage, ...args);
          break;
      }
    }

    // 保存到内存和 localStorage
    const logEntry: LogEntry = {
      timestamp,
      level,
      levelName,
      message,
      callerInfo: callerInfo || undefined,
      args: args.length > 0 ? args : undefined
    };

    this.logs.push(logEntry);
    saveLogsToStorage(this.logs);

    // 添加到待发送队列（仅发送 ERROR 和 WARN 级别）
    if (this.enableBackendSync && (level === LogLevel.ERROR || level === LogLevel.WARN)) {
      this.pendingLogs.push(logEntry);
      // 如果待发送日志达到批量大小，立即发送
      if (this.pendingLogs.length >= LOG_BATCH_SIZE) {
        this.flushPendingLogs();
      }
    }
  }

  debug(message: string, ...args: any[]) {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: any[]) {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.log(LogLevel.ERROR, message, ...args);
  }

  // 记录 API 请求
  apiRequest(method: string, url: string, data?: any) {
    this.debug(`${method} ${url}`, data ? { data } : '');
  }

  // 记录 API 响应
  apiResponse(method: string, url: string, status: number, data?: any) {
    const level = status >= 400 ? LogLevel.ERROR : 
                  status >= 300 ? LogLevel.WARN : LogLevel.DEBUG;
    this.log(level, `${method} ${url} - ${status}`, data ? { data } : '');
  }

  // 记录异常
  exception(error: Error, context = '') {
    const message = context ? `${context}: ${error.message}` : error.message;
    this.error(message);
    if (error.stack) {
      this.error('堆栈信息:', error.stack);
    }
  }

  // 性能监控：开始计时
  performanceStart(label: string) {
    this.performanceMarks.set(label, performance.now());
    this.debug(`[性能] 开始: ${label}`);
  }

  // 性能监控：结束计时并记录
  performanceEnd(label: string) {
    const startTime = this.performanceMarks.get(label);
    if (startTime !== undefined) {
      const duration = performance.now() - startTime;
      this.performanceMarks.delete(label);
      
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: LogLevel.DEBUG,
        levelName: 'PERFORMANCE',
        message: `[性能] 结束: ${label}`,
        performance: { duration, label }
      };
      
      this.logs.push(logEntry);
      saveLogsToStorage(this.logs);
      
      if (this.enableConsoleLog) {
        console.debug(`[${logEntry.timestamp}] [PERFORMANCE] ${label}: ${duration.toFixed(2)}ms`);
      }
    } else {
      this.warn(`[性能] 未找到开始标记: ${label}`);
    }
  }

  // 获取所有日志
  getLogs(filter?: { level?: LogLevel; startTime?: Date; endTime?: Date; keyword?: string }): LogEntry[] {
    let filtered = [...this.logs];

    if (filter) {
      if (filter.level !== undefined) {
        filtered = filtered.filter(log => log.level === filter.level);
      }
      if (filter.startTime) {
        const start = filter.startTime.getTime();
        filtered = filtered.filter(log => new Date(log.timestamp).getTime() >= start);
      }
      if (filter.endTime) {
        const end = filter.endTime.getTime();
        filtered = filtered.filter(log => new Date(log.timestamp).getTime() <= end);
      }
      if (filter.keyword) {
        const keyword = filter.keyword.toLowerCase();
        filtered = filtered.filter(log => 
          log.message.toLowerCase().includes(keyword) ||
          log.callerInfo?.toLowerCase().includes(keyword)
        );
      }
    }

    return filtered;
  }

  // 获取日志统计信息
  getLogStats() {
    const stats = {
      total: this.logs.length,
      byLevel: {
        [LogLevel.DEBUG]: 0,
        [LogLevel.INFO]: 0,
        [LogLevel.WARN]: 0,
        [LogLevel.ERROR]: 0
      },
      oldestLog: this.logs.length > 0 ? this.logs[0].timestamp : null,
      newestLog: this.logs.length > 0 ? this.logs[this.logs.length - 1].timestamp : null
    };

    this.logs.forEach(log => {
      if (stats.byLevel[log.level] !== undefined) {
        stats.byLevel[log.level]++;
      }
    });

    return stats;
  }

  // 导出日志为文本
  exportLogs(filter?: Parameters<Logger['getLogs']>[0]): string {
    const logs = this.getLogs(filter);
    return logs.map(log => {
      const caller = log.callerInfo ? ` [${log.callerInfo}]` : '';
      const perf = log.performance ? ` (${log.performance.duration?.toFixed(2)}ms)` : '';
      const args = log.args && log.args.length > 0 ? ' ' + JSON.stringify(log.args) : '';
      return `[${log.timestamp}] [${log.levelName}]${caller} ${log.message}${perf}${args}`;
    }).join('\n');
  }

  // 导出日志为 JSON
  exportLogsJSON(filter?: Parameters<Logger['getLogs']>[0]): string {
    return JSON.stringify(this.getLogs(filter), null, 2);
  }

  // 清空日志
  clearLogs() {
    this.logs = [];
    this.pendingLogs = [];
    try {
      localStorage.removeItem(LOG_STORAGE_KEY);
    } catch (error) {
      console.warn('清空日志失败:', error);
    }
  }

  // 手动刷新待发送日志
  async flushLogs() {
    await this.flushPendingLogs();
  }

  // 获取后端日志
  async getBackendLogs(options?: {
    startDate?: Date;
    endDate?: Date;
    level?: number;
    keyword?: string;
    limit?: number;
    source?: 'cached' | 'file';
  }) {
    try {
      const API_HOST = import.meta.env.DEV ? 'http://localhost:3001' : '';
      const source = options?.source || 'cached';
      const params = new URLSearchParams();
      
      if (options?.startDate) {
        params.append('startDate', options.startDate.toISOString());
      }
      if (options?.endDate) {
        params.append('endDate', options.endDate.toISOString());
      }
      if (options?.level !== undefined) {
        params.append('level', String(options.level));
      }
      if (options?.keyword) {
        params.append('keyword', options.keyword);
      }
      if (options?.limit) {
        params.append('limit', String(options.limit));
      }

      const url = `${API_HOST}/api/logs/backend/${source}${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.logs || [];
    } catch (error) {
      console.warn('获取后端日志失败:', error);
      return [];
    }
  }

  // 获取后端日志统计
  async getBackendLogStats() {
    try {
      const API_HOST = import.meta.env.DEV ? 'http://localhost:3001' : '';
      const response = await fetch(`${API_HOST}/api/logs/backend/stats`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.warn('获取后端日志统计失败:', error);
      return null;
    }
  }
}

// 创建默认日志实例
export const logger = new Logger();

// 导出日志类以便自定义
export { Logger };
export type { LogEntry };
