#!/usr/bin/env node

/**
 * 管理员密码重置工具
 * 
 * 使用方法：
 * 1. 直接重置为默认密码：node scripts/reset-password.cjs
 * 2. 重置为指定密码：node scripts/reset-password.cjs <新密码>
 * 
 * 注意：此脚本会直接重置密码，无需验证原密码，请妥善保管。
 */

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'admin.json');
const CONFIG_DIR = path.dirname(CONFIG_FILE);

// 确保配置目录存在
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// 获取命令行参数
const newPassword = process.argv[2];
const defaultPassword = 'admin123';

// 决定使用哪个密码
const passwordToSet = newPassword || defaultPassword;
const isDefault = !newPassword;

console.log('====================================');
console.log('管理员密码重置工具');
console.log('====================================\n');

if (isDefault) {
  console.log('⚠️  警告：将密码重置为默认密码 "admin123"');
  console.log('   重置后请立即登录并修改密码！\n');
} else {
  console.log(`⚠️  警告：将密码重置为指定的新密码`);
  console.log('   重置后请妥善保管新密码！\n');
}

// 生成密码哈希
console.log('正在生成密码哈希...');
const hash = bcrypt.hashSync(passwordToSet, 10);

// 读取现有配置或创建新配置
let config = {};
if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log('✓ 读取现有配置文件');
  } catch (error) {
    console.log('⚠️  配置文件损坏，将创建新配置');
  }
}

// 更新密码
config.passwordHash = hash;
config.resetAt = Date.now();
config.createdAt = config.createdAt || Date.now();

// 保存配置
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');

console.log('✓ 密码已重置成功！\n');
console.log('====================================');
if (isDefault) {
  console.log('默认密码：admin123');
  console.log('请立即登录并修改密码！');
} else {
  console.log('新密码已设置');
  console.log('请使用新密码登录');
}
console.log('====================================\n');

