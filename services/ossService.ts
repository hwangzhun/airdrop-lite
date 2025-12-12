import OSS from 'ali-oss';
import { OSSConfig } from '../types';

let ossClient: OSS | null = null;

export const initOSSClient = (config: OSSConfig): OSS | null => {
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.accessKeySecret) {
    return null;
  }

  try {
    ossClient = new OSS({
      region: config.region || '',
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucket,
    });
    return ossClient;
  } catch (error) {
    console.error('OSS初始化失败:', error);
    return null;
  }
};

export type UploadProgressCallback = (progress: number) => void;

export const uploadToOSS = async (
  file: File, 
  path: string, 
  config: OSSConfig,
  onProgress?: UploadProgressCallback
): Promise<string> => {
  const client = initOSSClient(config);
  if (!client) {
    throw new Error('OSS配置不完整，无法上传');
  }

  try {
    const result = await client.put(path, file, {
      progress: (p: number, cpt: number, total: number) => {
        if (onProgress) {
          // OSS SDK progress 回调参数：p 是百分比(0-1)，cpt 是已传输字节，total 是总字节
          // 使用 p (百分比) 或计算 cpt/total
          const progress = total > 0 ? Math.round((cpt / total) * 100) : Math.round(p * 100);
          onProgress(Math.min(100, Math.max(0, progress)));
        }
      }
    });
    return result.url;
  } catch (error: any) {
    throw new Error(`OSS上传失败: ${error.message || '未知错误'}`);
  }
};

export const downloadFromOSS = async (url: string): Promise<Blob> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('下载失败');
    }
    return await response.blob();
  } catch (error: any) {
    throw new Error(`OSS下载失败: ${error.message || '未知错误'}`);
  }
};

export const deleteFromOSS = async (path: string, config: OSSConfig): Promise<void> => {
  const client = initOSSClient(config);
  if (!client) {
    throw new Error('OSS配置不完整，无法删除');
  }

  try {
    await client.delete(path);
  } catch (error: any) {
    throw new Error(`OSS删除失败: ${error.message || '未知错误'}`);
  }
};


