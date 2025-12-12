import { FileRecord, AppSettings, StorageType } from '../types';
import { uploadToOSS } from './ossService';
import { uploadToLocalFile } from './localFileService';
import { logger } from './logger';

export type UploadProgressCallback = (progress: number, status: string) => void;

const SETTINGS_KEY = 'airdrop_lite_settings';
// 生产环境使用相对路径，开发环境使用 localhost
const FILE_API_BASE = import.meta.env.DEV 
  ? 'http://localhost:3001/api/files'
  : '/api/files';
const SETTINGS_API_BASE = import.meta.env.DEV 
  ? 'http://localhost:3001/api/settings'
  : '/api/settings';

// Helper: Generate SHA-256 Hash
export const calculateFileHash = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Helper: Generate 6-char random code
const generateCode = (): string => {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

type ApiError = Error & { status?: number };

const request = async <T>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const url = typeof input === 'string' ? input : input.toString();
  const method = init?.method || 'GET';
  
  logger.apiRequest(method, url, init?.body ? JSON.parse(init.body as string) : undefined);
  const startTime = performance.now();
  
  try {
    const response = await fetch(input, init);
    const responseTime = performance.now() - startTime;
    
    if (!response.ok) {
      let message = response.statusText;
      try {
        const payload = await response.json();
        message = payload?.error || payload?.message || message;
      } catch (_) {
        // ignore JSON parse errors
      }
      const error = new Error(message) as ApiError;
      error.status = response.status;
      logger.apiResponse(method, url, response.status, { error: message, responseTime: `${responseTime.toFixed(2)}ms` });
      throw error;
    }

    logger.apiResponse(method, url, response.status, { responseTime: `${responseTime.toFixed(2)}ms` });

    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    const responseTime = performance.now() - startTime;
    if (error.status) {
      // 错误已在上面的 if (!response.ok) 中记录
      throw error;
    }
    // 网络错误或其他错误
    logger.error(`API请求失败: ${method} ${url}`, { error: error.message, responseTime: `${responseTime.toFixed(2)}ms` });
    throw error;
  }
};

export const saveFile = async (
  file: File,
  onProgress?: UploadProgressCallback
): Promise<FileRecord> => {
  // 尝试从后端同步最新设置
  let settings = getSettings();
  try {
    const backendSettings = await request<AppSettings>(SETTINGS_API_BASE);
    // 合并设置，优先使用后端设置
    settings = { ...settings, ...backendSettings };
    // 更新本地设置
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // 如果后端不可用，使用本地设置
    console.warn('无法从后端获取设置，使用本地设置:', error);
  }
  
  onProgress?.(0, '准备中...');
  
  const existingFiles = await getAllFiles();
  const storageType = settings.storageType || StorageType.LOCAL_FILE;

  // 检查文件大小限制
  const maxFileSizeBytes = (settings.maxFileSizeMB || 100) * 1024 * 1024;
  if (file.size > maxFileSizeBytes) {
    throw new Error(`文件大小超过限制。最大允许: ${settings.maxFileSizeMB || 100}MB`);
  }

  // Basic quota check
  const storageLimitBytes = settings.storageLimitMB * 1024 * 1024;
  const currentStorage = existingFiles.reduce((acc, f) => acc + f.size, 0);

  if (currentStorage + file.size > storageLimitBytes) {
    throw new Error(`存储空间不足。当前限制: ${settings.storageLimitMB}MB`);
  }

  onProgress?.(5, '计算文件哈希...');
  const hash = await calculateFileHash(file);
  
  onProgress?.(10, '检查文件是否已存在...');
  // 检查是否已存在相同哈希的文件
  try {
    const existingFile = await request<FileRecord | null>(`${FILE_API_BASE}/hash/${hash}`);
    if (existingFile) {
      // 文件已存在，返回现有记录，不重复上传
      onProgress?.(100, '文件已存在');
      return existingFile;
    }
  } catch (error: any) {
    // 404 表示不存在，继续上传流程
    if (error.status !== 404) {
      throw error;
    }
  }

  const code = generateCode();
  const fileId = crypto.randomUUID();
  const timestamp = Date.now();

  // Generate storage path (使用安全的文件名，避免中文乱码)
  const fileExt = file.name.split('.').pop() || 'bin';
  const storagePath = `${code}_${timestamp}.${fileExt}`;

  let dataUrl: string;
  let storagePathUsed: string | undefined;

  // Upload based on storage type
  try {
    // 上传进度回调：将上传进度映射到 15-90% 的范围内
    const uploadProgressCallback = (uploadProgress: number) => {
      const mappedProgress = 15 + Math.floor((uploadProgress / 100) * 75);
      const status = storageType === StorageType.OSS ? '上传到 OSS...' : '上传到服务器...';
      onProgress?.(mappedProgress, status);
    };

    onProgress?.(15, storageType === StorageType.OSS ? '准备上传到 OSS...' : '准备上传到服务器...');
    
    switch (storageType) {
      case StorageType.OSS:
        if (!settings.ossConfig.endpoint || !settings.ossConfig.bucket) {
          throw new Error('OSS配置不完整，请先在控制台配置OSS');
        }
        dataUrl = await uploadToOSS(file, storagePath, settings.ossConfig, uploadProgressCallback);
        storagePathUsed = storagePath;
        break;

      case StorageType.LOCAL_FILE:
      default: {
        const result = await uploadToLocalFile(file, storagePath, uploadProgressCallback);
        dataUrl = result.url;
        storagePathUsed = result.storagePath;
        break;
      }
    }
  } catch (error: any) {
    throw new Error(`文件上传失败: ${error.message || '未知错误'}`);
  }
  
  onProgress?.(90, '保存文件记录...');

  // 计算过期时间
  let expireDate: number | undefined;
  const expireDays = settings.defaultExpireDays ?? 7; // 默认7天，如果未设置
  if (expireDays > 0) {
    expireDate = timestamp + (expireDays * 24 * 60 * 60 * 1000);
  }

  const newFile: FileRecord = {
    id: fileId,
    name: file.name,
    size: file.size,
    type: file.type,
    hash,
    uploadDate: timestamp,
    code,
    data: dataUrl,
    storageType,
    storagePath: storagePathUsed,
    downloadCount: 0,
    expireDate
  };

  const savedFile = await request<FileRecord>(FILE_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newFile)
  });
  
  onProgress?.(100, '上传完成');
  return savedFile;
};

export const getFileByCode = async (code: string): Promise<FileRecord | null> => {
  try {
    return await request<FileRecord>(`${FILE_API_BASE}/code/${code}`);
  } catch (error: any) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
};

export const getFileById = async (id: string): Promise<FileRecord | null> => {
  try {
    return await request<FileRecord>(`${FILE_API_BASE}/${id}`);
  } catch (error: any) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
};

export const getAllFiles = (): Promise<FileRecord[]> => {
  return request<FileRecord[]>(FILE_API_BASE);
};

export const deleteFile = async (id: string): Promise<void> => {
  await request(`${FILE_API_BASE}/${id}`, { method: 'DELETE' });
};

export const incrementDownloadCount = async (id: string): Promise<void> => {
  await request(`${FILE_API_BASE}/${id}/download`, { method: 'PATCH' });
};

export const getSettings = (): AppSettings => {
  const data = localStorage.getItem(SETTINGS_KEY);
  if (data) {
    const parsed = JSON.parse(data);
    let storageType = parsed.storageType;
    if (!storageType) {
      storageType = StorageType.LOCAL_FILE;
    }
    return {
      ...parsed,
      storageType,
      maxFileSizeMB: parsed.maxFileSizeMB ?? 100,
      defaultExpireDays: parsed.defaultExpireDays ?? 7,
      ossConfig: parsed.ossConfig || {
        endpoint: '',
        bucket: '',
        region: '',
        accessKeyId: '',
        accessKeySecret: ''
      }
    };
  } else {
    const defaults: AppSettings = { 
      storageLimitMB: 100, 
      allowPublicUploads: true,
      installDate: Date.now(),
      storageType: StorageType.LOCAL_FILE,
      maxFileSizeMB: 100,
      defaultExpireDays: 7,
      ossConfig: {
        endpoint: '',
        bucket: '',
        region: '',
        accessKeyId: '',
        accessKeySecret: ''
      }
    };
    saveSettings(defaults);
    return defaults;
  }
};

export const saveSettings = async (settings: AppSettings): Promise<void> => {
  // 同时保存到localStorage和后端
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  
  try {
    await request<AppSettings>(SETTINGS_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  } catch (error) {
    console.warn('保存设置到后端失败，仅保存到本地:', error);
  }
};

// 从后端同步设置
export const syncSettingsFromBackend = async (): Promise<AppSettings> => {
  try {
    const backendSettings = await request<AppSettings>(SETTINGS_API_BASE);
    // 合并本地和后端设置，优先使用后端设置
    const merged = { ...getSettings(), ...backendSettings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  } catch (error) {
    console.warn('从后端同步设置失败，使用本地设置:', error);
    return getSettings();
  }
};

export const updateFileAiDescription = async (id: string, description: string): Promise<void> => {
  await request(`${FILE_API_BASE}/${id}/ai-description`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description })
  });
};
