const crypto = require('crypto');

// 简单的内存 session 存储（生产环境建议使用 Redis 或数据库）
const sessions = new Map();

// Session 过期时间（7天）
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000;

// 生成 session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 创建 session
function createSession() {
  const token = generateSessionToken();
  const expiresAt = Date.now() + SESSION_EXPIRY;
  
  sessions.set(token, {
    createdAt: Date.now(),
    expiresAt: expiresAt
  });
  
  // 定期清理过期 session
  cleanupExpiredSessions();
  
  return { token, expiresAt };
}

// 验证 session
function verifySession(token) {
  if (!token) {
    return false;
  }
  
  const session = sessions.get(token);
  
  if (!session) {
    return false;
  }
  
  // 检查是否过期
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  
  // 更新过期时间（滑动过期）
  session.expiresAt = Date.now() + SESSION_EXPIRY;
  
  return true;
}

// 删除 session
function deleteSession(token) {
  if (token) {
    sessions.delete(token);
  }
}

// 清理过期 session
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }
}

// 定期清理（每小时清理一次）
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

module.exports = {
  createSession,
  verifySession,
  deleteSession
};

