const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const logger = require('./backend/logger.cjs');

// 全局错误处理
process.on('uncaughtException', (err) => {
  logger.exception(err, '未捕获的异常');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的 Promise 拒绝:', reason);
  logger.error('Promise:', promise);
});

// 加载路由模块（添加错误处理）
let filesRouter, authRouter, settingsRouter, logRouter;
try {
  filesRouter = require('./backend/filesRoutes.cjs');
  authRouter = require('./backend/authRoutes.cjs');
  settingsRouter = require('./backend/settingsRoutes.cjs');
  logRouter = require('./backend/logRoutes.cjs');
} catch (err) {
  logger.exception(err, '加载路由模块失败');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// 确保必要的目录存在
const UPLOAD_DIR = path.join(__dirname, 'uploadfiles');
const DATA_DIR = path.join(__dirname, 'data');
const LOGS_DIR = path.join(__dirname, 'logs');

[UPLOAD_DIR, DATA_DIR, LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`已创建目录: ${dir}`);
  }
});

// 配置 multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const customPath = req.body?.path;
    if (customPath && typeof customPath === 'string') {
      cb(null, customPath);
    } else {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `fallback_${timestamp}${ext}`);
    }
  }
});

// 动态获取文件大小限制
const getFileSizeLimit = () => {
  try {
    const settingsService = require('./backend/settingsService.cjs');
    const settings = settingsService.getSettings();
    return (settings.maxFileSizeMB || 100) * 1024 * 1024; // 转换为字节
  } catch (error) {
    return 100 * 1024 * 1024; // 默认100MB
  }
};

const upload = multer({ 
  storage,
  limits: {
    fileSize: getFileSizeLimit()
  }
});

// HTTP 请求日志中间件
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    logger.httpRequest(req, res, responseTime);
  });
  
  next();
});

// CORS 配置（生产环境建议指定具体域名）
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['*'];
  
  if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// API 路由
app.use('/api/files', filesRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logRouter);

// 文件上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    // 检查是否是文件大小超限错误
    if (req.headers['content-length']) {
      const contentLength = parseInt(req.headers['content-length']);
      const maxSize = getFileSizeLimit();
      if (contentLength > maxSize) {
        const maxSizeMB = (maxSize / 1024 / 1024).toFixed(0);
        logger.warn(`文件上传失败: 文件大小超过限制 (${contentLength} bytes > ${maxSize} bytes)`);
        return res.status(413).json({ error: `文件大小超过限制（最大 ${maxSizeMB}MB）` });
      }
    }
    logger.warn('文件上传失败: 没有文件被上传');
    return res.status(400).json({ error: '没有文件被上传' });
  }
  
  // 再次验证文件大小（multer可能不会在limits中抛出错误）
  const settingsService = require('./backend/settingsService.cjs');
  const settings = settingsService.getSettings();
  const maxSizeBytes = (settings.maxFileSizeMB || 100) * 1024 * 1024;
  if (req.file.size > maxSizeBytes) {
    // 删除已上传的文件
    const fs = require('fs');
    try {
      fs.unlinkSync(req.file.path);
      logger.debug(`已删除超限文件: ${req.file.path}`);
    } catch (err) {
      logger.warn(`删除超限文件失败: ${req.file.path}`, err);
    }
    const maxSizeMB = settings.maxFileSizeMB || 100;
    logger.warn(`文件上传失败: 文件大小超过限制 (${req.file.size} bytes > ${maxSizeBytes} bytes)`);
    return res.status(413).json({ error: `文件大小超过限制（最大 ${maxSizeMB}MB）` });
  }
  
  const filePath = req.file.filename;
  const fileUrl = `/uploadfiles/${filePath}`;
  logger.info(`文件上传成功: ${req.file.originalname} -> ${filePath} (${req.file.size} bytes)`);
  res.json({
    success: true,
    url: fileUrl,
    path: filePath
  });
});

// 处理multer文件大小错误（必须在所有路由之后）
app.use((error, req, res, next) => {
  if (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        const settingsService = require('./backend/settingsService.cjs');
        const settings = settingsService.getSettings();
        const maxSizeMB = settings.maxFileSizeMB || 100;
        return res.status(413).json({ error: `文件大小超过限制（最大 ${maxSizeMB}MB）` });
      }
      return res.status(400).json({ error: `上传错误: ${error.message}` });
    }
    logger.exception(error, '服务器错误');
    return res.status(500).json({ error: error.message || '服务器内部错误' });
  }
  next();
});

// 文件删除接口
app.delete('/api/delete', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    logger.warn('文件删除失败: 缺少文件路径参数');
    return res.status(400).json({ error: '缺少文件路径参数' });
  }
  const fullPath = path.join(UPLOAD_DIR, filePath);
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    logger.warn(`文件删除失败: 非法路径 ${filePath}`);
    return res.status(403).json({ error: '非法路径' });
  }
  fs.unlink(fullPath, (err) => {
    if (err) {
      if (err.code === 'ENOENT') {
        logger.warn(`文件删除失败: 文件不存在 ${filePath}`);
        return res.status(404).json({ error: '文件不存在' });
      }
      logger.exception(err, `文件删除失败 ${filePath}`);
      return res.status(500).json({ error: '删除失败' });
    }
    logger.info(`文件删除成功: ${filePath}`);
    res.json({ success: true });
  });
});

// 静态文件服务（上传的文件）- 添加中间件以从数据库获取原始文件名
app.use('/uploadfiles', (req, res, next) => {
  // 获取请求的文件名
  const requestedFileName = path.basename(req.path);
  
  // 尝试从数据库查询原始文件名
  try {
    const filesRepo = require('./backend/filesRepository.cjs');
    // 通过 storagePath 查询文件记录
    const fileRecord = filesRepo.getFileByStoragePath(requestedFileName);
    
    // 如果找到文件记录，使用原始文件名
    if (fileRecord && fileRecord.name) {
      // 设置正确的文件名到响应头
      // 使用 encodeURIComponent 处理中文文件名，同时提供兼容格式
      const encodedFileName = encodeURIComponent(fileRecord.name);
      res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
    } else {
      // 如果没找到，使用请求的文件名
      const encodedFileName = encodeURIComponent(requestedFileName);
      res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
    }
  } catch (error) {
    // 如果查询失败，使用请求的文件名
    logger.debug(`查询文件记录失败: ${requestedFileName}`, error);
    const encodedFileName = encodeURIComponent(requestedFileName);
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
  }
  
  next();
}, express.static(UPLOAD_DIR));

// 前端静态文件服务（必须在最后）
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  
  // 前端路由回退（SPA 支持）
  // Express 5.x 不支持 '*' 或 '/*' 通配符，使用正则表达式匹配所有路径
  app.get(/.*/, (req, res) => {
    // 排除 API 路由和静态文件路由
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploadfiles/')) {
      return res.status(404).json({ error: '路由不存在' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  logger.warn('警告: dist 目录不存在，前端静态文件服务未启用');
  logger.warn('请先运行 npm run build 构建前端');
}

// 文件过期清理任务
const cleanupExpiredFiles = () => {
  try {
    const filesRepo = require('./backend/filesRepository.cjs');
    const expiredFiles = filesRepo.getExpiredFiles();
    
    if (expiredFiles.length > 0) {
      logger.info(`发现 ${expiredFiles.length} 个过期文件，开始清理...`);
      
      expiredFiles.forEach(file => {
        try {
          // 删除物理文件
          if (file.storageType === 'localFile' && file.storagePath) {
            const fullPath = path.join(UPLOAD_DIR, file.storagePath);
            if (fullPath.startsWith(UPLOAD_DIR) && fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              logger.debug(`已删除物理文件: ${file.storagePath}`);
            }
          }
          
          // 删除数据库记录
          filesRepo.deleteFile(file.id);
          logger.info(`已删除文件记录: ${file.name} (${file.code})`);
        } catch (error) {
          logger.exception(error, `删除过期文件失败 ${file.id}`);
        }
      });
      
      logger.info(`清理完成，共删除 ${expiredFiles.length} 个过期文件`);
    }
  } catch (error) {
    logger.exception(error, '清理过期文件时出错');
  }
};

// 启动定时清理任务（每小时检查一次）
setInterval(cleanupExpiredFiles, 60 * 60 * 1000);
// 启动时立即执行一次
setTimeout(cleanupExpiredFiles, 5000); // 延迟5秒，确保数据库已初始化

// 启动服务器（添加错误处理）
const server = app.listen(PORT, () => {
  logger.info('=================================');
  logger.info('AirDrop-Lite 服务器已启动');
  logger.info(`端口: ${PORT}`);
  logger.info(`上传目录: ${UPLOAD_DIR}`);
  logger.info(`数据目录: ${DATA_DIR}`);
  logger.info(`日志目录: ${LOGS_DIR}`);
  logger.info(`环境: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`日志级别: ${process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')}`);
  logger.info('=================================');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`错误: 端口 ${PORT} 已被占用`);
    logger.error('请检查是否有其他程序正在使用该端口，或修改 PORT 环境变量');
  } else {
    logger.exception(err, '服务器启动错误');
  }
  process.exit(1);
});

