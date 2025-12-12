<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AirDrop-Lite 极简快传

一个极简文件传输应用，支持快速分享文件，通过 6 位取件码即可下载。


## ✨ 特性

- 🚀 **极简设计** - 简洁美观的用户界面，操作简单直观
- 📤 **快速分享** - 上传文件后自动生成 6 位取件码，轻松分享
- 📥 **便捷接收** - 输入取件码即可下载文件，支持图片预览
- 💾 **灵活存储** - 支持本地文件存储和阿里云 OSS 对象存储
- 📊 **后台管理** - 完整的文件管理后台，支持统计和设置
- 🔒 **安全可靠** - SHA-256 文件哈希验证，确保文件完整性
- 📱 **响应式设计** - 完美适配桌面和移动设备

## 🛠️ 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Express + Node.js
- **数据库**: SQLite
- **存储**: 本地文件存储 / 阿里云 OSS
- **构建工具**: Vite
- **进程管理**: PM2

## 📦 安装

**前置要求:**

- Node.js 18+
- npm 或 yarn

### 快速开始

1. **安装依赖:**
   ```bash
   npm install
   ```

2. **运行应用:**

   **方式一：同时启动前后端（推荐）**
   ```bash
   npm run dev:all
   ```
   这会同时启动前端（端口 3000）和后端（端口 3001）
   
   **方式二：分别启动**
   ```bash
   # 终端 1：启动前端
   npm run dev
   
   # 终端 2：启动后端
   npm run dev:server
   ```

3. **访问应用:**
   - 打开浏览器访问: http://localhost:3000
   - 后端 API 运行在: http://localhost:3001

## 🎯 主要功能

### 发送文件
- 支持拖拽上传和点击选择
- 自动生成 6 位取件码
- 生成分享链接，一键复制
- 文件哈希值计算和显示

### 接收文件
- 输入 6 位取件码快速下载
- 图片文件自动预览
- 文件信息展示（大小、下载次数等）

### 后台管理
- 管理员登录认证
- 文件列表管理（查看、删除、预览）
- 统计面板（文件数、存储占用、下载次数）
- 系统设置（存储限制、公开上传开关）
- 存储方式切换（本地/OSS）
- OSS 配置管理

## 💾 存储方式

项目支持两种存储方式，可在后台管理中切换：

1. **本地文件存储** - 文件存储在服务器 `uploadfiles` 目录
2. **OSS 对象存储** - 支持阿里云 OSS 或其他兼容 S3 的存储服务

详细配置说明请参考 [存储功能说明](md/README-STORAGE.md)

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## 🛠️ 可用命令

### 开发命令
- `npm run dev` - 启动前端开发服务器（端口 3000）
- `npm run dev:server` - 启动后端服务器（端口 3001）
- `npm run dev:all` - 同时启动前端和后端（推荐）

### 构建命令
- `npm run build` - 构建生产版本
- `npm run preview` - 预览生产版本
- `npm run package` - 打包部署文件到 `deploy/` 目录
- `npm run build:deploy` - 构建并打包部署文件（一键部署）

### 数据库命令
- `npm run reset:db` - 重置数据库（保留文件）
- `npm run reset:db:clean` - 重置数据库并清理所有文件

## 🚀 部署

项目支持多种部署方式，详细部署指南请参考：

- [部署指南](md/部署指南.md) - 完整的部署步骤和配置说明

### 快速部署

```bash
# 1. 构建并打包
npm run build:deploy

# 2. 将 deploy/ 目录上传到服务器

# 3. 在服务器上安装依赖并启动
cd deploy
npm install --production
pm2 start ecosystem.config.cjs
```

## 📁 项目结构

```text
airdrop-lite/
├── components/          # 组件目录
│   └── Icons.tsx       # SVG 图标组件
├── services/           # 服务层
│   ├── authService.ts  # 认证服务
│   ├── localFileService.ts  # 本地文件服务
│   ├── ossService.ts   # OSS 存储服务
│   └── storageService.ts    # 存储管理服务
├── views/              # 视图组件
│   ├── SendView.tsx    # 发送文件视图
│   ├── ReceiveView.tsx # 接收文件视图
│   └── AdminView.tsx   # 后台管理视图
├── backend/            # 后端代码
│   ├── authRoutes.cjs  # 认证路由
│   ├── authService.cjs # 认证服务
│   ├── db.cjs          # 数据库连接
│   ├── filesRoutes.cjs # 文件路由
│   ├── filesRepository.cjs # 文件仓储
│   ├── sessionService.cjs  # 会话服务
│   ├── settingsRoutes.cjs  # 设置路由
│   └── settingsService.cjs # 设置服务
├── scripts/            # 脚本工具
│   ├── reset-db.cjs    # 重置数据库
│   └── reset-password.cjs # 重置密码
├── data/               # 数据目录（SQLite 数据库）
├── uploadfiles/        # 上传文件存储目录
├── deploy/             # 部署目录（构建后生成）
├── App.tsx             # 主应用组件
├── server.cjs          # 服务器入口文件
└── vite.config.ts      # Vite 配置
```

## ⚙️ 配置说明

### 环境变量

创建 `.env.local` 文件（开发环境）或设置环境变量（生产环境）：

```env
# 服务器端口（可选，默认 3001）
PORT=3001

# CORS 允许的源（可选，生产环境建议设置）
ALLOWED_ORIGINS=https://yourdomain.com
```

### 默认管理员密码

- 默认密码: `admin123`
- 如需重置密码，请参考 [密码重置指南](md/README-PASSWORD-RESET.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。
