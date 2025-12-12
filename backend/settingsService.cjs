const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultSettings = {
  storageLimitMB: 100,
  allowPublicUploads: true,
  installDate: Date.now(),
  storageType: 'localFile',
  maxFileSizeMB: 100, // 默认最大文件大小100MB
  defaultExpireDays: 7, // 默认7天过期
  ossConfig: {
    endpoint: '',
    bucket: '',
    region: '',
    accessKeyId: '',
    accessKeySecret: ''
  }
};

const getSettings = () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const settings = JSON.parse(data);
      // 合并默认设置，确保新字段存在
      return { ...defaultSettings, ...settings };
    }
  } catch (error) {
    console.error('读取设置失败:', error);
  }
  return defaultSettings;
};

const saveSettings = (settings) => {
  try {
    // 合并现有设置，避免覆盖未提供的字段
    const currentSettings = getSettings();
    const mergedSettings = { ...currentSettings, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(mergedSettings, null, 2), 'utf8');
    return mergedSettings;
  } catch (error) {
    console.error('保存设置失败:', error);
    throw error;
  }
};

module.exports = {
  getSettings,
  saveSettings
};



