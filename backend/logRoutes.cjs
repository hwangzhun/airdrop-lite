const express = require('express');
const logger = require('./logger.cjs');
const { checkAuth } = require('./authService.cjs');

const router = express.Router();

// 所有日志路由都需要身份验证
router.use((req, res, next) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
  if (!checkAuth(token)) {
    return res.status(401).json({ error: '未授权访问' });
  }
  next();
});

// 获取后端日志（从缓存）
router.get('/backend/cached', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = logger.getCachedLogs(limit);
    res.json({ logs, total: logs.length });
  } catch (error) {
    logger.exception(error, '获取缓存日志失败');
    res.status(500).json({ error: error.message || '获取日志失败' });
  }
});

// 从文件读取后端日志
router.get('/backend/file', (req, res) => {
  try {
    const options = {
      startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
      level: req.query.level !== undefined ? parseInt(req.query.level) : undefined,
      keyword: req.query.keyword || undefined,
      limit: parseInt(req.query.limit) || 100
    };
    const logs = logger.readLogsFromFile(options);
    res.json({ logs, total: logs.length });
  } catch (error) {
    logger.exception(error, '读取日志文件失败');
    res.status(500).json({ error: error.message || '读取日志失败' });
  }
});

// 获取后端日志统计信息
router.get('/backend/stats', (req, res) => {
  try {
    const stats = logger.getLogStats();
    res.json(stats);
  } catch (error) {
    logger.exception(error, '获取日志统计失败');
    res.status(500).json({ error: error.message || '获取统计失败' });
  }
});

// 接收前端日志
router.post('/frontend', (req, res) => {
  try {
    const { logs } = req.body;
    if (!Array.isArray(logs)) {
      return res.status(400).json({ error: '日志数据格式错误' });
    }

    // 记录前端日志到后端
    logs.forEach(logEntry => {
      const { level, message, timestamp, callerInfo, args } = logEntry;
      const logMessage = `[前端] ${message}${callerInfo ? ` [${callerInfo}]` : ''}`;
      
      switch (level) {
        case 0: // DEBUG
          logger.debug(logMessage, ...(args || []));
          break;
        case 1: // INFO
          logger.info(logMessage, ...(args || []));
          break;
        case 2: // WARN
          logger.warn(logMessage, ...(args || []));
          break;
        case 3: // ERROR
          logger.error(logMessage, ...(args || []));
          break;
        default:
          logger.info(logMessage, ...(args || []));
      }
    });

    res.json({ success: true, received: logs.length });
  } catch (error) {
    logger.exception(error, '接收前端日志失败');
    res.status(500).json({ error: error.message || '接收日志失败' });
  }
});

// 清空后端日志缓存
router.post('/backend/clear-cache', (req, res) => {
  try {
    logger.clearCache();
    res.json({ success: true, message: '缓存已清空' });
  } catch (error) {
    logger.exception(error, '清空缓存失败');
    res.status(500).json({ error: error.message || '清空缓存失败' });
  }
});

module.exports = router;

