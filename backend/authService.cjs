const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const sessionService = require('./sessionService.cjs');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'admin.json');
const CONFIG_DIR = path.dirname(CONFIG_FILE);

// 确保配置目录存在
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// 初始化配置文件
function initConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    // 生成默认密码 admin123 的哈希
    const hash = bcrypt.hashSync('admin123', 10);
    const config = {
      passwordHash: hash,
      createdAt: Date.now()
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return config;
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    // 如果配置文件损坏，重新初始化
    console.warn('配置文件损坏，重新初始化...');
    const hash = bcrypt.hashSync('admin123', 10);
    const config = {
      passwordHash: hash,
      createdAt: Date.now()
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return config;
  }
}

// 获取配置
function getConfig() {
  return initConfig();
}

// 验证密码
function verifyPassword(password) {
  const config = getConfig();
  
  // 如果密码哈希为空或无效，重新初始化
  if (!config.passwordHash || config.passwordHash.trim() === '') {
    console.warn('密码哈希为空，重新初始化默认密码...');
    const hash = bcrypt.hashSync('admin123', 10);
    config.passwordHash = hash;
    config.createdAt = Date.now();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  }
  
  return bcrypt.compareSync(password, config.passwordHash);
}

// 更新密码
function updatePassword(newPassword) {
  try {
    const hash = bcrypt.hashSync(newPassword, 10);
    const config = getConfig();
    config.passwordHash = hash;
    config.updatedAt = Date.now();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('更新密码失败:', error);
    throw new Error('更新密码失败');
  }
}

module.exports = {
  verifyPassword,
  updatePassword,
  getConfig,
  checkAuth
};

// 校验 session token 是否有效
function checkAuth(token) {
  return sessionService.verifySession(token);
}

