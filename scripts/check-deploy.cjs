#!/usr/bin/env node

/**
 * 部署环境检查脚本
 * 检查服务器上是否已正确安装依赖
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_MODULES = [
  'express',
  'multer',
  'cookie-parser',
  'bcrypt',
  'better-sqlite3',
  'ali-oss'
];

function checkNodeModules() {
  const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
  
  if (!fs.existsSync(nodeModulesPath)) {
    console.error('❌ 错误: node_modules 目录不存在！');
    console.error('\n请先安装依赖：');
    console.error('  npm install --production');
    return false;
  }

  console.log('✓ node_modules 目录存在');

  // 检查必需的模块
  let allModulesExist = true;
  const missingModules = [];

  for (const module of REQUIRED_MODULES) {
    const modulePath = path.join(nodeModulesPath, module);
    if (!fs.existsSync(modulePath)) {
      missingModules.push(module);
      allModulesExist = false;
    }
  }

  if (!allModulesExist) {
    console.error('\n❌ 缺少以下必需的模块：');
    missingModules.forEach(module => {
      console.error(`  - ${module}`);
    });
    console.error('\n请运行以下命令安装依赖：');
    console.error('  npm install --production');
    return false;
  }

  console.log('✓ 所有必需的模块已安装');
  return true;
}

function checkRequiredFiles() {
  const requiredFiles = [
    'server.cjs',
    'backend',
    'package.json'
  ];

  let allFilesExist = true;
  const missingFiles = [];

  for (const file of requiredFiles) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
      allFilesExist = false;
    }
  }

  if (!allFilesExist) {
    console.error('\n❌ 缺少以下必需的文件：');
    missingFiles.forEach(file => {
      console.error(`  - ${file}`);
    });
    return false;
  }

  console.log('✓ 所有必需的文件存在');
  return true;
}

function main() {
  console.log('========================================');
  console.log('AirDrop-Lite 部署环境检查');
  console.log('========================================\n');

  const filesOk = checkRequiredFiles();
  const modulesOk = checkNodeModules();

  console.log('\n========================================');
  
  if (filesOk && modulesOk) {
    console.log('✅ 环境检查通过，可以启动服务');
    console.log('========================================\n');
    console.log('启动命令：');
    console.log('  pm2 start ecosystem.config.cjs');
    console.log('  或');
    console.log('  node server.cjs\n');
    process.exit(0);
  } else {
    console.log('❌ 环境检查失败，请先解决上述问题');
    console.log('========================================\n');
    process.exit(1);
  }
}

main();



