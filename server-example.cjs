// 后端API示例文件
// 此文件展示了如何实现本地文件存储的后端API
// 可以使用 Express.js、Koa.js 或其他Node.js框架

const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const filesRouter = require('./backend/filesRoutes.cjs');
const authRouter = require('./backend/authRoutes.cjs');

const app = express();
const PORT = 3001;

// 确保 uploadfiles 目录存在
const UPLOAD_DIR = path.join(__dirname, 'uploadfiles');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 配置 multer 用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // multer 会自动解析 multipart/form-data 中的字段到 req.body
    // 使用前端传来的 path（格式：code_timestamp.ext，不包含中文）
    const customPath = req.body?.path;
    if (customPath && typeof customPath === 'string') {
      // 使用前端传来的安全路径（code_timestamp.ext 格式）
      cb(null, customPath);
    } else {
      // 如果没有提供path，生成一个安全的文件名（不应该发生）
      const timestamp = Date.now();
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `fallback_${timestamp}${ext}`);
    }
  }
});

const upload = multer({ storage });

// 启用 CORS（支持 credentials）
app.use((req, res, next) => {
  // 允许前端域名（开发环境允许所有，生产环境应指定具体域名）
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true'); // 允许携带 cookie
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 支持更大的请求体（用于文件上传）
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use('/api/files', filesRouter);
app.use('/api/auth', authRouter);

// 文件上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有文件被上传' });
  }

  // 使用存储的文件名（已经是 code_timestamp.ext 格式，不包含中文）
  const filePath = req.file.filename;
  // 直接使用文件名，不需要URL编码（因为文件名已经是安全的ASCII字符）
  const fileUrl = `/uploadfiles/${filePath}`;

  res.json({
    success: true,
    url: fileUrl,
    path: filePath
  });
});

// 文件删除接口
app.delete('/api/delete', (req, res) => {
  const { path: filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: '缺少文件路径参数' });
  }

  const fullPath = path.join(UPLOAD_DIR, filePath);

  // 安全检查：确保文件在uploadfiles目录内
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    return res.status(403).json({ error: '非法路径' });
  }

  fs.unlink(fullPath, (err) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: '文件不存在' });
      }
      return res.status(500).json({ error: '删除失败' });
    }

    res.json({ success: true });
  });
});

// 静态文件服务（用于下载）
app.use('/uploadfiles', express.static(UPLOAD_DIR, {
  setHeaders: (res, filePath) => {
    // 从数据库获取原始文件名（如果需要）
    // 这里简化处理，直接使用存储的文件名
    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  }
}));

app.listen(PORT, () => {
  console.log(`文件存储服务运行在 http://localhost:${PORT}`);
  console.log(`上传目录: ${UPLOAD_DIR}`);
});



