# 存储功能说明

## 存储方式

项目现在支持两种存储方式，可以在控制台（后台管理）中自由选择：

### 1. 本地文件存储 (uploadfiles文件夹)
- **存储位置**: 服务器 `uploadfiles` 文件夹
- **文件格式**: 原始文件
- **限制**: 由服务器磁盘空间决定
- **优点**: 文件以原始格式存储，不占用浏览器空间
- **缺点**: 需要后端API支持

### 2. OSS对象存储
- **存储位置**: 阿里云OSS（或其他兼容S3的OSS）
- **文件格式**: 原始文件
- **限制**: 由OSS配置决定
- **优点**: 可扩展性强，支持CDN加速
- **缺点**: 需要配置OSS账户信息

## 配置说明

### 切换存储方式

1. 进入后台管理页面（点击页面底部的"后台管理"）
2. 使用密码登录
3. 在"基础设置"中选择"存储方式"
4. 保存设置

### OSS配置

如果选择OSS存储，需要填写以下信息：

- **Endpoint**: OSS地域节点（如：`oss-cn-hangzhou.aliyuncs.com`）
- **Bucket Name**: OSS存储桶名称
- **Access Key ID**: OSS访问密钥ID
- **Access Key Secret**: OSS访问密钥Secret

### 本地文件存储配置

如果选择本地文件存储，需要：

1. 安装后端依赖：
```bash
npm install express multer
```

2. 启动后端服务（参考 `server-example.cjs`）：
```bash
node server-example.cjs
```

3. 确保 `uploadfiles` 文件夹存在且有写入权限

4. 修改 `services/localFileService.ts` 中的 `API_BASE_URL` 为你的后端地址

## 文件索引（SQLite）

- 所有上传文件的元数据（取件码、文件名、大小、下载次数等）持久化在 `data/files.db` 中
- 数据库由 `better-sqlite3` 驱动，Express 服务启动时自动创建并建表
- 前端通过 `/api/files` 系列接口（POST/GET/DELETE/PATCH）与数据库交互
- `data/` 目录已在 `.gitignore` 中忽略，如需备份请手动复制数据库文件

## 注意事项

1. **存储方式切换**: 切换存储方式后，新上传的文件将使用新方式存储，已存在的文件不受影响
2. **AI分析功能**: AI分析功能会自动下载文件并转换为Base64进行分析，支持所有存储方式
3. **文件预览**: OSS和本地文件存储的文件预览可能受到CORS限制
4. **数据迁移**: 切换存储方式不会自动迁移已有文件，需要手动重新上传
5. **默认存储方式**: 默认使用本地文件存储，需要后端API支持

## 后端API要求

如果使用本地文件存储，后端需要提供以下API：

### POST /api/upload
上传文件
- **Content-Type**: `multipart/form-data`
- **参数**: 
  - `file`: 文件对象
  - `path`: 文件存储路径（可选）
- **返回**: `{ success: true, url: string, path: string }`

### DELETE /api/delete
删除文件
- **Content-Type**: `application/json`
- **Body**: `{ path: string }`
- **返回**: `{ success: true }`

### GET /uploadfiles/*
静态文件服务，用于文件下载

## 技术实现

- **OSS SDK**: `ali-oss` (阿里云OSS官方SDK)
- **本地文件存储**: 通过后端API实现，文件存储在服务器 `uploadfiles` 文件夹
- **元数据存储**: 通过 SQLite (`data/files.db`) 持久化文件信息，提供 `/api/files` CRUD 接口

