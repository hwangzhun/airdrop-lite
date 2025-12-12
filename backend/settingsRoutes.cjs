const express = require('express');
const settingsService = require('./settingsService.cjs');
const logger = require('./logger.cjs');

const router = express.Router();

// 获取设置
router.get('/', (req, res) => {
  logger.debug('获取设置请求');
  try {
    const settings = settingsService.getSettings();
    logger.debug('设置获取成功');
    res.json(settings);
  } catch (error) {
    logger.exception(error, '获取设置失败');
    res.status(500).json({ error: error.message || '获取设置失败' });
  }
});

// 保存设置
router.post('/', (req, res) => {
  const settings = req.body;
  logger.debug('保存设置请求', { settings });
  try {
    const saved = settingsService.saveSettings(settings);
    logger.info('设置保存成功', { 
      storageType: saved.storageType,
      maxFileSizeMB: saved.maxFileSizeMB,
      storageLimitMB: saved.storageLimitMB
    });
    res.json(saved);
  } catch (error) {
    logger.exception(error, '保存设置失败');
    res.status(500).json({ error: error.message || '保存设置失败' });
  }
});

module.exports = router;


