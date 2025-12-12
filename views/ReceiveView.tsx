import React, { useState, useEffect } from 'react';
import { getFileByCode, incrementDownloadCount } from '../services/storageService';
import { FileRecord, StorageType } from '../types';
import { DownloadIcon, FileIcon } from '../components/Icons';
import { logger } from '../services/logger';

interface ReceiveViewProps {
  initialCode?: string;
}

export const ReceiveView: React.FC<ReceiveViewProps> = ({ initialCode }) => {
  const [code, setCode] = useState(initialCode || '');
  const [file, setFile] = useState<FileRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    if (initialCode) {
      handleRetrieve(initialCode);
    }
  }, [initialCode]);

  const handleRetrieve = async (codeToSearch: string) => {
    setError(null);
    setFile(null);
    
    if (codeToSearch.length < 6) return;

    setIsLoading(true);
    logger.performanceStart('file_retrieve');
    logger.info(`查询文件: code=${codeToSearch}`);
    
    try {
      const foundFile = await getFileByCode(codeToSearch);
      if (foundFile) {
        // 检查文件是否过期
        if (foundFile.expireDate && foundFile.expireDate <= Date.now()) {
          logger.warn(`文件已过期: code=${codeToSearch}`, { expireDate: foundFile.expireDate });
          setError("文件已过期，无法下载。");
          setIsLoading(false);
          return;
        }
        logger.performanceEnd('file_retrieve');
        logger.info(`文件查询成功: ${foundFile.name}`, { code: codeToSearch, id: foundFile.id });
        setFile(foundFile);
      } else {
        logger.warn(`文件未找到: code=${codeToSearch}`);
        setError("未找到文件。请检查取件码并重试。");
      }
    } catch (err: any) {
      logger.performanceEnd('file_retrieve');
      logger.exception(err, `查询文件失败: code=${codeToSearch}`);
      setError(err.message || '查询失败，请稍后重试。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().slice(0, 6);
    setCode(val);
    if (val.length === 6) {
      handleRetrieve(val);
    }
  };

  const handleDownload = async () => {
    if (!file) return;
    
    logger.performanceStart('file_download');
    logger.info(`开始下载文件: ${file.name}`, { code: file.code, id: file.id });
    
    try {
      // 统一使用文件URL直接下载，让浏览器自己处理进度显示
      let downloadUrl: string;
      
      if (file.storageType === StorageType.OSS) {
        // OSS文件直接使用URL
        downloadUrl = file.data;
      } else {
        // 本地文件需要构建完整URL
        const API_HOST = import.meta.env.DEV ? 'http://localhost:3001' : '';
        downloadUrl = file.data.startsWith('http') ? file.data : `${API_HOST}${file.data}`;
      }

      // Track download
      await incrementDownloadCount(file.id);
      logger.debug(`下载次数已更新: ${file.name}`, { downloadCount: file.downloadCount + 1 });

      // 直接使用链接下载，浏览器会显示正确的进度
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = file.name;
      link.target = '_blank'; // 在新标签页打开，避免页面跳转
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      logger.performanceEnd('file_download');
      logger.info(`文件下载成功: ${file.name}`, { code: file.code });
    } catch (error: any) {
      logger.performanceEnd('file_download');
      logger.exception(error, `文件下载失败: ${file.name}`);
      alert(`下载失败: ${error.message || '未知错误'}`);
    }
  };

  const handleCopyHash = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = file.hash;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedHash(true);
        setTimeout(() => setCopiedHash(false), 2000);
      } catch (err) {
        alert('复制失败，请手动复制');
      }
      document.body.removeChild(textArea);
    }
  };


  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-900">接收文件</h2>
        <p className="text-zinc-500 mt-2">输入6位取件码下载文件。</p>
      </div>

      {!file ? (
        <>
        <div className="bg-white rounded-2xl p-2 shadow-sm border border-zinc-200 flex items-center">
          <input
            type="text"
            value={code}
            onChange={handleInputChange}
            placeholder="输入取件码"
            className="flex-1 bg-transparent px-6 py-4 text-lg tracking-widest font-mono uppercase focus:outline-none placeholder-zinc-300 text-zinc-900"
            maxLength={6}
          />
          <button 
            onClick={() => handleRetrieve(code)}
              disabled={code.length < 6 || isLoading}
            className="bg-black text-white w-14 h-14 rounded-xl flex items-center justify-center hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <DownloadIcon className="w-6 h-6" />
          </button>
        </div>
          {isLoading && (
            <div className="mt-4 text-center text-sm text-zinc-400">查询中...</div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-zinc-100 animate-fade-in">
          {/* Preview Section */}
          <div className="bg-zinc-50 aspect-video flex items-center justify-center border-b border-zinc-100 relative">
            {file.type.startsWith('image/') ? (
              <img 
                src={file.data} 
                alt="Preview" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  // Fallback for OSS/localFile URLs that might have CORS issues
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            ) : (
              <FileIcon className="w-20 h-20 text-zinc-300" />
            )}
          </div>

          <div className="p-6">
            <h3 className="text-xl font-semibold text-zinc-900 truncate mb-1" title={file.name}>
              {file.name}
            </h3>
            <div className="flex items-center gap-3 text-sm text-zinc-500 mb-4">
              <span>{(file.size / 1024).toFixed(1)} KB</span>
              <span className="w-1 h-1 bg-zinc-300 rounded-full"></span>
              <span className="uppercase">{file.type.split('/')[1] || 'FILE'}</span>
            </div>
            {file.expireDate && (
              <div className="mb-6 text-xs text-zinc-400">
                过期时间: {new Date(file.expireDate).toLocaleString('zh-CN')}
                {file.expireDate <= Date.now() && (
                  <span className="ml-2 text-red-500">（已过期）</span>
                )}
              </div>
            )}

            <div className="space-y-4">
              <button 
                onClick={handleDownload}
                className="w-full bg-black text-white font-medium h-12 rounded-xl hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2"
              >
                <DownloadIcon className="w-5 h-5" />
                下载文件
              </button>

              <div className="bg-zinc-50 rounded-lg p-3 border border-zinc-100 relative">
                <div className="text-[10px] uppercase text-zinc-400 font-bold tracking-wider mb-1">SHA-256 哈希值</div>
                <div 
                  onClick={handleCopyHash}
                  className="text-xs font-mono text-zinc-600 break-all leading-relaxed cursor-pointer hover:text-black transition-colors relative"
                  title="点击复制哈希值"
                >
                  {file.hash}
                  {copiedHash && (
                    <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50 pointer-events-none">
                      已复制
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button 
              onClick={() => { setFile(null); setCode(''); }}
              className="mt-6 w-full text-sm text-zinc-400 hover:text-zinc-900 transition-colors"
            >
              接收其他文件
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 text-center animate-pulse">
          {error}
        </div>
      )}

      {/* 免责声明 */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
        <div className="font-semibold mb-2">免责声明</div>
        <div className="space-y-1 text-gray-500 leading-relaxed">
          <p>• 本服务仅提供文件传输功能，不保证文件的存储时间，文件可能因系统维护、存储空间限制或其他原因被提前删除。</p>
          <p>• 服务提供者不对因文件丢失、损坏或无法访问造成的任何损失承担责任。</p>
          <p>• 建议及时下载文件，避免因过期或删除导致无法获取。</p>
        </div>
      </div>
    </div>
  );
};