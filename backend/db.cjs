const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'files.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const init = () => {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      type TEXT NOT NULL,
      hash TEXT NOT NULL,
      uploadDate INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL,
      storageType TEXT NOT NULL,
      storagePath TEXT,
      downloadCount INTEGER DEFAULT 0,
      aiDescription TEXT,
      expireDate INTEGER
    )
  `).run();

  // 添加expireDate字段（如果表已存在但没有该字段）
  try {
    db.prepare(`ALTER TABLE files ADD COLUMN expireDate INTEGER`).run();
  } catch (err) {
    // 字段已存在，忽略错误
  }

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_code ON files(code)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_expireDate ON files(expireDate)`).run();
};

init();

module.exports = db;


