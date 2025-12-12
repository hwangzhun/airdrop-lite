#!/usr/bin/env node

/**
 * 数据库重置工具
 * 
 * 使用方法：
 * 1. 重置数据库（保留上传文件）：node scripts/reset-db.cjs
 * 2. 重置数据库和上传文件：node scripts/reset-db.cjs --clean-files
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploadfiles');
const DB_FILES = ['files.db', 'files.db-shm', 'files.db-wal'];

const cleanFiles = process.argv.includes('--clean-files');

console.log('====================================');
console.log('数据库重置工具');
console.log('====================================\n');

// 检查并删除数据库文件
console.log('正在检查数据库文件...');
let deletedCount = 0;

for (const dbFile of DB_FILES) {
  const dbPath = path.join(DATA_DIR, dbFile);
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      console.log(`✓ 已删除: ${dbFile}`);
      deletedCount++;
    } catch (error) {
      console.error(`❌ 删除失败: ${dbFile}`, error.message);
    }
  }
}

if (deletedCount === 0) {
  console.log('ℹ️  未找到数据库文件，可能已经是初始状态');
} else {
  console.log(`\n✓ 已删除 ${deletedCount} 个数据库文件`);
}

// 可选：清理上传文件
if (cleanFiles) {
  console.log('\n正在清理上传文件...');
  if (fs.existsSync(UPLOAD_DIR)) {
    try {
      const files = fs.readdirSync(UPLOAD_DIR);
      let fileCount = 0;
      
      for (const file of files) {
        // 跳过 .gitkeep 等隐藏文件
        if (file.startsWith('.')) continue;
        
        const filePath = path.join(UPLOAD_DIR, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
          fileCount++;
        } else if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
          fileCount++;
        }
      }
      
      if (fileCount > 0) {
        console.log(`✓ 已删除 ${fileCount} 个上传文件/目录`);
      } else {
        console.log('ℹ️  上传目录为空，无需清理');
      }
    } catch (error) {
      console.error('❌ 清理上传文件失败:', error.message);
    }
  } else {
    console.log('ℹ️  上传目录不存在，无需清理');
  }
}

console.log('\n====================================');
console.log('✅ 数据库重置完成！');
console.log('====================================\n');
console.log('下一步：');
console.log('1. 重启后端服务（如果正在运行）');
console.log('2. 数据库将在首次启动时自动创建');
if (!cleanFiles) {
  console.log('\n提示：如需同时清理上传文件，请使用：');
  console.log('  node scripts/reset-db.cjs --clean-files');
}
console.log('');



