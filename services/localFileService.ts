// Local file storage service (requires backend API)
// This service communicates with a backend API to store files in uploadfiles folder

// 生产环境使用相对路径，开发环境使用 localhost
export const API_HOST = import.meta.env.DEV 
  ? 'http://localhost:3001' 
  : ''; // 生产环境使用相对路径（前后端同域）
const API_BASE_URL = `${API_HOST}/api`; // REST API base URL

export interface LocalUploadResult {
  url: string;
  storagePath: string;
}

export type UploadProgressCallback = (progress: number) => void;

export const uploadToLocalFile = async (
  file: File, 
  path: string,
  onProgress?: UploadProgressCallback
): Promise<LocalUploadResult> => {
  const formData = new FormData();
  formData.append('file', file);
  // 确保路径正确编码，避免中文乱码
  // path 已经是 code_timestamp.ext 格式，不包含中文，但为了安全还是编码
  formData.append('path', path);
  // 同时传递原始文件名用于记录
  formData.append('originalName', file.name);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // 监听上传进度
    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      });
    }

    // 监听请求完成
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          const storagePath = result.path || path;
          const relativeUrl = result.url || `/uploadfiles/${storagePath}`;
          const fileUrl = relativeUrl.startsWith('http')
            ? relativeUrl
            : `${API_HOST}${relativeUrl}`;
          resolve({ url: fileUrl, storagePath });
        } catch (error: any) {
          reject(new Error('解析服务器响应失败'));
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.error || error.message || '上传失败'));
        } catch {
          reject(new Error(`上传失败: ${xhr.statusText}`));
        }
      }
    });

    // 监听错误
    xhr.addEventListener('error', () => {
      reject(new Error('本地文件存储服务不可用，请检查后端API配置'));
    });

    // 监听取消
    xhr.addEventListener('abort', () => {
      reject(new Error('上传已取消'));
    });

    // 发送请求
    xhr.open('POST', `${API_BASE_URL}/upload`);
    xhr.send(formData);
  });
};

export const downloadFromLocalFile = async (url: string): Promise<Blob> => {
  const targetUrl = url.startsWith('http') ? url : `${API_HOST}${url}`;
  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error('下载失败');
    }
    return await response.blob();
  } catch (error: any) {
    throw new Error(`本地文件下载失败: ${error.message || '未知错误'}`);
  }
};

export const deleteLocalFile = async (path: string): Promise<void> => {
  try {
    const response = await fetch(`${API_BASE_URL}/delete`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: '删除失败' }));
      throw new Error(error.message || '删除失败');
    }
  } catch (error: any) {
    throw new Error(`本地文件删除失败: ${error.message || '未知错误'}`);
  }
};

