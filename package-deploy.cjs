#!/usr/bin/env node

/**
 * 打包部署文件脚本
 * 将前端构建产物和后端代码整理到 deploy/ 目录
 */

const fs = require('fs');
const path = require('path');

const DEPLOY_DIR = path.join(__dirname, 'deploy');
const SOURCE_DIR = __dirname;

// 需要复制的文件和目录
const filesToCopy = [
  // 前端构建产物
  { src: 'dist', dest: 'dist' },
  
  // 后端代码
  { src: 'backend', dest: 'backend' },
  
  // 服务器入口文件
  { src: 'server.cjs', dest: 'server.cjs' },
  
  // 配置文件
  { src: 'ecosystem.config.cjs', dest: 'ecosystem.config.cjs' },
  { src: 'package.json', dest: 'package.json' },
  { src: 'package-lock.json', dest: 'package-lock.json' },
  
  // 数据目录（如果存在，但会排除数据库文件，让数据库在首次运行时自动创建）
  { src: 'data', dest: 'data', optional: true },
];

// 需要创建的目录
const dirsToCreate = [
  'uploadfiles',
  'logs',
  'data'
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      // 排除数据库文件，让数据库在首次运行时自动创建
      if (entry.endsWith('.db') || entry.endsWith('.db-shm') || entry.endsWith('.db-wal')) {
        continue;
      }
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      copyRecursive(srcPath, destPath);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function main() {
  console.log('========================================');
  console.log('AirDrop-Lite 部署文件打包');
  console.log('========================================\n');

  // 检查 dist 目录是否存在
  const distPath = path.join(SOURCE_DIR, 'dist');
  if (!fs.existsSync(distPath)) {
    console.error('❌ 错误: dist 目录不存在！');
    console.error('请先运行 npm run build 构建前端');
    process.exit(1);
  }

  // 清理旧的部署目录
  if (fs.existsSync(DEPLOY_DIR)) {
    console.log('清理旧的部署目录...');
    fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }

  // 创建部署目录
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  console.log('✓ 创建部署目录: deploy/\n');

  // 复制文件
  console.log('正在复制文件...');
  for (const item of filesToCopy) {
    const srcPath = path.join(SOURCE_DIR, item.src);
    const destPath = path.join(DEPLOY_DIR, item.dest);

    if (!fs.existsSync(srcPath)) {
      if (item.optional) {
        console.log(`⚠ 跳过可选文件: ${item.src} (不存在)`);
        continue;
      } else {
        console.error(`❌ 错误: 文件不存在: ${item.src}`);
        process.exit(1);
      }
    }

    try {
      copyRecursive(srcPath, destPath);
      console.log(`✓ 复制: ${item.src} -> ${item.dest}`);
    } catch (error) {
      console.error(`❌ 复制失败: ${item.src}`, error.message);
      process.exit(1);
    }
  }

  // 创建必要的目录
  console.log('\n正在创建必要的目录...');
  for (const dir of dirsToCreate) {
    const dirPath = path.join(DEPLOY_DIR, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`✓ 创建目录: ${dir}/`);
    }
  }

  // 创建 .gitkeep 文件（如果需要保留空目录）
  const gitkeepFiles = [
    path.join(DEPLOY_DIR, 'uploadfiles', '.gitkeep'),
    path.join(DEPLOY_DIR, 'logs', '.gitkeep'),
  ];
  for (const gitkeep of gitkeepFiles) {
    if (!fs.existsSync(gitkeep)) {
      fs.writeFileSync(gitkeep, '');
    }
  }

  // 复制部署检查脚本
  const checkScriptSrc = path.join(SOURCE_DIR, 'scripts', 'check-deploy.cjs');
  const checkScriptDest = path.join(DEPLOY_DIR, 'check-deploy.cjs');
  if (fs.existsSync(checkScriptSrc)) {
    fs.copyFileSync(checkScriptSrc, checkScriptDest);
    console.log(`✓ 复制: scripts/check-deploy.cjs -> check-deploy.cjs`);
  }

  // 复制权限修复脚本
  const fixPermsScriptSrc = path.join(SOURCE_DIR, 'scripts', 'fix-permissions.sh');
  const fixPermsScriptDest = path.join(DEPLOY_DIR, 'fix-permissions.sh');
  if (fs.existsSync(fixPermsScriptSrc)) {
    fs.copyFileSync(fixPermsScriptSrc, fixPermsScriptDest);
    // 设置执行权限（在 Linux 上）
    try {
      fs.chmodSync(fixPermsScriptDest, 0o755);
    } catch (e) {
      // Windows 上可能失败，忽略
    }
    console.log(`✓ 复制: scripts/fix-permissions.sh -> fix-permissions.sh`);
  }

  // 创建部署说明文件
  const readmeContent = `# AirDrop-Lite 部署包

此目录包含部署所需的所有文件。

## ⚠️ 重要提示

**部署前必须先安装依赖！** 如果直接启动服务会报错 "Cannot find module 'express'"。

## 部署步骤

### 1. 上传部署包到服务器

将整个 \`deploy/\` 目录上传到服务器的目标位置，例如：
\`\`\`bash
/www/wwwroot/airdrop-lite/
\`\`\`

### 2. 进入部署目录

\`\`\`bash
cd /www/wwwroot/airdrop-lite
# 或您上传到的其他路径
\`\`\`

### 3. 安装依赖（必须！）

\`\`\`bash
npm install --production
\`\`\`

**这一步非常重要！** 如果不安装依赖，服务将无法启动。

### 4. 检查部署环境（可选但推荐）

\`\`\`bash
node check-deploy.cjs
\`\`\`

这个脚本会检查：
- node_modules 是否存在
- 所有必需的模块是否已安装
- 必需的文件是否存在

### 5. 使用 PM2 启动服务

\`\`\`bash
pm2 start ecosystem.config.cjs
\`\`\`

### 6. 查看服务状态

\`\`\`bash
pm2 status
pm2 logs airdrop-lite
\`\`\`

### 7. 设置开机自启（可选）

\`\`\`bash
pm2 startup
pm2 save
\`\`\`

## 常见问题

### 错误: Cannot find module 'express'

**原因**：没有安装依赖

**解决方法**：
\`\`\`bash
cd /www/wwwroot/airdrop-lite
npm install --production
\`\`\`

### 如何重新安装依赖

如果依赖安装有问题，可以删除 node_modules 后重新安装：
\`\`\`bash
rm -rf node_modules package-lock.json
npm install --production
\`\`\`

## 目录结构

- \`dist/\` - 前端构建产物
- \`backend/\` - 后端代码（无需编译）
- \`server.cjs\` - 服务器入口文件
- \`ecosystem.config.cjs\` - PM2 配置文件
- \`package.json\` - 依赖配置
- \`package-lock.json\` - 依赖锁定文件
- \`check-deploy.cjs\` - 部署环境检查脚本
- \`data/\` - 数据目录（SQLite 数据库和配置文件）
- \`uploadfiles/\` - 上传文件存储目录
- \`logs/\` - 日志目录

## 注意事项

- 后端代码是 .cjs 文件，无需编译，可直接运行
- 确保 Node.js 版本 >= 18
- 默认端口: 3001（可在 ecosystem.config.cjs 中修改）
- **部署时必须先运行 \`npm install --production\` 安装依赖**
`;

  const readmePath = path.join(DEPLOY_DIR, 'README-DEPLOY.md');
  fs.writeFileSync(readmePath, readmeContent);
  console.log(`✓ 创建说明文件: README-DEPLOY.md`);

  console.log('\n========================================');
  console.log('✅ 打包完成！');
  console.log('========================================\n');
  console.log('部署目录: deploy/');
  console.log('\n⚠️  重要：部署到服务器后必须先安装依赖！');
  console.log('\n部署步骤:');
  console.log('1. 将 deploy/ 目录上传到服务器');
  console.log('2. 进入部署目录: cd /path/to/deploy');
  console.log('3. 安装依赖（必须！）: npm install --production');
  console.log('4. 检查环境（可选）: node check-deploy.cjs');
  console.log('5. 启动服务: pm2 start ecosystem.config.cjs');
  console.log('\n详细说明请查看: deploy/README-DEPLOY.md\n');
}

main();

