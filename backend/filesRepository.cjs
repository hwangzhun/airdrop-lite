const db = require('./db.cjs');

const insertFile = (file) => {
  const stmt = db.prepare(`
    INSERT INTO files (
      id, name, size, type, hash, uploadDate, code, data,
      storageType, storagePath, downloadCount, aiDescription, expireDate
    )
    VALUES (
      @id, @name, @size, @type, @hash, @uploadDate, @code, @data,
      @storageType, @storagePath, @downloadCount, @aiDescription, @expireDate
    )
  `);

  stmt.run({
    ...file,
    downloadCount: file.downloadCount ?? 0,
    aiDescription: file.aiDescription ?? null,
    expireDate: file.expireDate ?? null
  });

  return getFileById(file.id);
};

const getAllFiles = () => {
  return db.prepare(`SELECT * FROM files ORDER BY uploadDate DESC`).all();
};

const getFileById = (id) => {
  return db.prepare(`SELECT * FROM files WHERE id = ?`).get(id);
};

const getFileByCode = (code) => {
  return db.prepare(`SELECT * FROM files WHERE upper(code) = upper(?)`).get(code);
};

const getFileByHash = (hash) => {
  return db.prepare(`SELECT * FROM files WHERE hash = ?`).get(hash);
};

const getFileByStoragePath = (storagePath) => {
  return db.prepare(`SELECT * FROM files WHERE storagePath = ?`).get(storagePath);
};

const deleteFile = (id) => {
  return db.prepare(`DELETE FROM files WHERE id = ?`).run(id);
};

const incrementDownloadCount = (id) => {
  const stmt = db.prepare(`
    UPDATE files
    SET downloadCount = downloadCount + 1
    WHERE id = ?
  `);
  stmt.run(id);
  return getFileById(id);
};

const getExpiredFiles = () => {
  const now = Date.now();
  return db.prepare(`
    SELECT * FROM files 
    WHERE expireDate IS NOT NULL AND expireDate <= ?
  `).all(now);
};

module.exports = {
  insertFile,
  getAllFiles,
  getFileById,
  getFileByCode,
  getFileByHash,
  getFileByStoragePath,
  deleteFile,
  incrementDownloadCount,
  getExpiredFiles
};


