export interface FileRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  hash: string; // SHA-256
  uploadDate: number;
  code: string; // The 6-digit retrieval code
  data: string; // URL for OSS or localFile storage
  storageType: StorageType; // Storage type used
  storagePath?: string; // Path/URL for OSS or localFile storage
  downloadCount: number; // New: Track downloads
  expireDate?: number; // 文件过期时间（时间戳，可选）
}

export interface OSSConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export enum StorageType {
  LOCAL_FILE = 'localFile', // Files in uploadfiles folder
  OSS = 'oss' // OSS object storage
}

export interface AppSettings {
  storageLimitMB: number;
  allowPublicUploads: boolean;
  installDate: number; // To calculate uptime
  storageType: StorageType; // Current storage type
  ossConfig: OSSConfig; // OSS settings
  maxFileSizeMB: number; // 单个文件最大大小限制（MB）
  defaultExpireDays: number; // 默认文件过期天数（0表示永不过期）
}

export enum ViewState {
  HOME = 'HOME',
  SEND = 'SEND',
  RECEIVE = 'RECEIVE',
  ADMIN = 'ADMIN'
}