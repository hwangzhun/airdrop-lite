const express = require('express');
const authService = require('./authService.cjs');
const sessionService = require('./sessionService.cjs');
const logger = require('./logger.cjs');

const router = express.Router();

// Session cookie 配置
const COOKIE_NAME = 'admin_session';
const COOKIE_OPTIONS = {
  httpOnly: true, // 防止 XSS 攻击
  secure: false, // 开发环境设为 false，生产环境应设为 true（需要 HTTPS）
  sameSite: 'lax', // CSRF 保护
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7天
};

// 验证密码接口（登录）
router.post('/verify', (req, res) => {
  const { password } = req.body;
  logger.debug('密码验证请求');
  
  if (!password || typeof password !== 'string') {
    logger.warn('密码验证失败: 密码为空或类型错误');
    return res.status(400).json({ error: '密码不能为空' });
  }

  try {
    const isValid = authService.verifyPassword(password);
    if (isValid) {
      // 创建 session
      const { token, expiresAt } = sessionService.createSession();
      
      // 设置 cookie
      res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
      
      logger.info(`密码验证成功，已创建会话: expiresAt=${new Date(expiresAt).toISOString()}`);
      res.json({ 
        success: true, 
        message: '验证成功',
        expiresAt: expiresAt
      });
    } else {
      logger.warn('密码验证失败: 密码错误');
      res.status(401).json({ error: '密码错误' });
    }
  } catch (error) {
    logger.exception(error, '密码验证时出错');
    res.status(500).json({ error: error.message || '验证失败' });
  }
});

// 验证 session 接口（检查是否已登录）
router.get('/check', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  
  if (!token) {
    logger.debug('会话检查: 无token');
    return res.status(401).json({ authenticated: false });
  }
  
  const isValid = sessionService.verifySession(token);
  
  if (isValid) {
    logger.debug('会话检查: 有效');
    res.json({ authenticated: true });
  } else {
    logger.debug('会话检查: 无效或已过期');
    // 清除无效的 cookie
    res.clearCookie(COOKIE_NAME);
    res.status(401).json({ authenticated: false });
  }
});

// 登出接口
router.post('/logout', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  
  if (token) {
    sessionService.deleteSession(token);
    logger.info('用户已登出，会话已删除');
  }
  
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true, message: '已登出' });
});

// 修改密码接口（需要验证 session）
router.post('/change-password', (req, res) => {
  // 验证 session
  const token = req.cookies[COOKIE_NAME];
  if (!token || !sessionService.verifySession(token)) {
    logger.warn('修改密码失败: 未登录或会话已过期');
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  
  const { oldPassword, newPassword } = req.body;
  logger.debug('密码修改请求');
  
  if (!oldPassword || typeof oldPassword !== 'string') {
    logger.warn('修改密码失败: 原密码为空或类型错误');
    return res.status(400).json({ error: '原密码不能为空' });
  }
  
  if (!newPassword || typeof newPassword !== 'string') {
    logger.warn('修改密码失败: 新密码为空或类型错误');
    return res.status(400).json({ error: '新密码不能为空' });
  }
  
  if (newPassword.length < 6) {
    logger.warn('修改密码失败: 新密码长度不足');
    return res.status(400).json({ error: '新密码长度至少6位' });
  }

  try {
    // 先验证原密码
    const isValid = authService.verifyPassword(oldPassword);
    if (!isValid) {
      logger.warn('修改密码失败: 原密码错误');
      return res.status(401).json({ error: '原密码错误' });
    }

    // 更新密码
    authService.updatePassword(newPassword);
    logger.info('密码修改成功');
    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    logger.exception(error, '修改密码时出错');
    res.status(500).json({ error: error.message || '修改密码失败' });
  }
});

module.exports = router;

