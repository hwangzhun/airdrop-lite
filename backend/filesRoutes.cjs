const express = require('express');
const path = require('path');
const fs = require('fs');
const filesRepo = require('./filesRepository.cjs');
const logger = require('./logger.cjs');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploadfiles');

router.get('/', (req, res) => {
  const { code } = req.query;
  if (code) {
    logger.debug(`查询文件: code=${code}`);
    const file = filesRepo.getFileByCode(code);
    if (!file) {
      logger.warn(`文件不存在: code=${code}`);
      return res.status(404).json({ error: '文件不存在' });
    }
    logger.debug(`文件查询成功: code=${code}, name=${file.name}`);
    return res.json(file);
  }

  logger.debug('获取所有文件列表');
  const files = filesRepo.getAllFiles();
  logger.debug(`返回 ${files.length} 个文件`);
  res.json(files);
});

router.get('/code/:code', (req, res) => {
  const code = req.params.code;
  logger.debug(`通过取件码查询文件: code=${code}`);
  const file = filesRepo.getFileByCode(code);
  if (!file) {
    logger.warn(`文件不存在: code=${code}`);
    return res.status(404).json({ error: '文件不存在' });
  }
  logger.debug(`文件查询成功: code=${code}, name=${file.name}`);
  res.json(file);
});

router.get('/hash/:hash', (req, res) => {
  const hash = req.params.hash;
  logger.debug(`通过哈希查询文件: hash=${hash}`);
  const file = filesRepo.getFileByHash(hash);
  if (!file) {
    logger.warn(`文件不存在: hash=${hash}`);
    return res.status(404).json({ error: '文件不存在' });
  }
  logger.debug(`文件查询成功: hash=${hash}, name=${file.name}`);
  res.json(file);
});

router.get('/:id', (req, res) => {
  const id = req.params.id;
  logger.debug(`通过ID查询文件: id=${id}`);
  const file = filesRepo.getFileById(id);
  if (!file) {
    logger.warn(`文件不存在: id=${id}`);
    return res.status(404).json({ error: '文件不存在' });
  }
  logger.debug(`文件查询成功: id=${id}, name=${file.name}`);
  res.json(file);
});

router.post('/', (req, res) => {
  const file = req.body;
  logger.debug(`创建文件记录: code=${file?.code}, name=${file?.name}`);

  if (!file?.id || !file?.code || !file?.data) {
    logger.warn('创建文件记录失败: 缺少必要的文件字段', { file });
    return res.status(400).json({ error: '缺少必要的文件字段' });
  }

  try {
    const saved = filesRepo.insertFile(file);
    logger.info(`文件记录创建成功: id=${saved.id}, code=${saved.code}, name=${saved.name}, size=${saved.size}`);
    res.status(201).json(saved);
  } catch (error) {
    logger.exception(error, `保存文件记录失败: code=${file?.code}`);
    res.status(500).json({ error: error.message || '保存文件失败' });
  }
});

router.patch('/:id/download', (req, res) => {
  const id = req.params.id;
  logger.debug(`增加下载次数: id=${id}`);
  const file = filesRepo.getFileById(id);
  if (!file) {
    logger.warn(`文件不存在: id=${id}`);
    return res.status(404).json({ error: '文件不存在' });
  }
  const updated = filesRepo.incrementDownloadCount(id);
  logger.info(`下载次数已更新: id=${id}, code=${updated.code}, 下载次数=${updated.downloadCount}`);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = req.params.id;
  logger.debug(`删除文件: id=${id}`);
  const file = filesRepo.getFileById(id);
  if (!file) {
    logger.warn(`文件不存在: id=${id}`);
    return res.status(404).json({ error: '文件不存在' });
  }

  if (file.storageType === 'localFile' && file.storagePath) {
    const fullPath = path.join(UPLOAD_DIR, file.storagePath);
    if (fullPath.startsWith(UPLOAD_DIR) && fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        logger.debug(`已删除物理文件: ${file.storagePath}`);
      } catch (error) {
        logger.exception(error, `删除物理文件失败: ${file.storagePath}`);
      }
    } else {
      logger.warn(`物理文件不存在或路径无效: ${file.storagePath}`);
    }
  }

  filesRepo.deleteFile(id);
  logger.info(`文件记录删除成功: id=${id}, code=${file.code}, name=${file.name}`);
  res.json({ success: true });
});

module.exports = router;




