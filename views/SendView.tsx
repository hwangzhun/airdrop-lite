import React, { useState, useRef, useEffect } from 'react';
import { saveFile, getSettings } from '../services/storageService';
import { FileRecord, StorageType } from '../types';
import { UploadIcon, FileIcon } from '../components/Icons';
import { logger } from '../services/logger';

export const SendView: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<FileRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageType, setStorageType] = useState<StorageType>(StorageType.LOCAL_FILE);
  const [defaultExpireDays, setDefaultExpireDays] = useState<number>(7);
  const [copiedCode, setCopiedCode] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const settings = getSettings();
    setStorageType(settings.storageType || StorageType.LOCAL_FILE);
    setDefaultExpireDays(settings.defaultExpireDays || 7);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFile = async (file: File) => {
    setIsUploading(true);
    setError(null);
    setUploadProgress(0);
    setUploadStatus('准备中...');
    
    logger.performanceStart('file_upload');
    logger.info(`开始处理文件上传: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    
    // 前端文件大小验证
    const settings = getSettings();
    const maxFileSizeBytes = (settings.maxFileSizeMB || 100) * 1024 * 1024;
    if (file.size > maxFileSizeBytes) {
      const errorMsg = `文件大小超过限制。最大允许: ${settings.maxFileSizeMB || 100}MB`;
      logger.warn(`文件上传失败: ${errorMsg}`, { fileName: file.name, fileSize: file.size });
      setError(errorMsg);
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
      return;
    }
    
    try {
      const record = await saveFile(file, (progress, status) => {
        setUploadProgress(progress);
        setUploadStatus(status);
      });
      logger.performanceEnd('file_upload');
      logger.info(`文件上传成功: ${record.name}`, { 
        code: record.code, 
        id: record.id, 
        size: record.size,
        storageType: record.storageType 
      });
      setUploadedFile(record);
      setIsUploading(false);
    } catch (err: any) {
      logger.performanceEnd('file_upload');
      logger.exception(err, `文件上传失败: ${file.name}`);
      setError(err.message || '上传失败');
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const reset = () => {
    setUploadedFile(null);
    setError(null);
    setCopiedCode(false);
    setUploadProgress(0);
    setUploadStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopyCode = async () => {
    if (!uploadedFile) return;
    try {
      await navigator.clipboard.writeText(uploadedFile.code);
      logger.debug(`复制取件码: ${uploadedFile.code}`);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = uploadedFile.code;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        logger.debug(`复制取件码 (fallback): ${uploadedFile.code}`);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } catch (err) {
        logger.warn('复制取件码失败', err);
        alert('复制失败，请手动复制');
      }
      document.body.removeChild(textArea);
    }
  };

  if (uploadedFile) {
    const shareLink = `${window.location.origin}${window.location.pathname}#receive?code=${uploadedFile.code}`;

    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-zinc-100 text-center">
          <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <UploadIcon className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-semibold text-zinc-900 mb-2">准备分享！</h2>
          <p className="text-zinc-500 mb-8">将取件码或链接分享给接收方。</p>

          <div className="bg-zinc-50 p-6 rounded-xl mb-6 border border-zinc-100 relative">
            <div 
              onClick={handleCopyCode}
              className="text-4xl font-mono font-bold tracking-widest text-zinc-900 mb-2 cursor-pointer hover:text-black transition-colors relative inline-block"
              title="点击复制取件码"
            >
              {uploadedFile.code}
              {copiedCode && (
                <span className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50 pointer-events-none">
                  已复制
                </span>
              )}
            </div>
            <div className="text-xs uppercase tracking-wide text-zinc-400 font-medium">取件码</div>
          </div>

          <div className="mb-6 text-left">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2 block">直连链接</label>
            <div className="flex">
              <input 
                readOnly 
                value={shareLink}
                className="flex-1 bg-zinc-50 border border-zinc-200 text-zinc-600 text-sm rounded-l-lg px-3 py-2 focus:outline-none"
              />
              <button 
                onClick={() => navigator.clipboard.writeText(shareLink)}
                className="bg-black text-white text-sm font-medium px-4 rounded-r-lg hover:bg-zinc-800 transition-colors"
              >
                复制
              </button>
            </div>
          </div>

          <button 
            onClick={reset}
            className="text-sm text-zinc-400 hover:text-zinc-900 font-medium transition-colors"
          >
            发送其他文件
          </button>

          {/* 免责声明 */}
          <div className="mt-6 p-4 border border-gray-200 rounded-xl text-xs text-gray-500">
            <div className="font-semibold mb-2">免责声明</div>
            <div className="space-y-1 text-gray-500 leading-relaxed">
              <p>• 本服务仅提供文件传输功能，不保证文件的存储时间，文件可能因系统维护、存储空间限制或其他原因被提前删除。</p>
              <p>• 请勿上传涉及隐私、敏感或违法的内容，服务提供者不对用户上传的文件内容负责。</p>
              <p>• 建议及时下载文件，服务提供者不对因文件丢失、损坏或无法访问造成的任何损失承担责任。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-900">发送文件</h2>
        <p className="text-zinc-500 mt-2">简单、安全、临时的文件分享工具。</p>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative group cursor-pointer
          border-2 border-dashed rounded-3xl p-12 text-center transition-all duration-200
          ${isDragging 
            ? 'border-black bg-zinc-50 scale-[1.02]' 
            : 'border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50/50'
          }
          ${isUploading ? 'opacity-50 pointer-events-none' : ''}
        `}
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          onChange={handleFileSelect} 
        />
        
        <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-white group-hover:shadow-sm transition-all">
          <UploadIcon className="w-8 h-8 text-zinc-400 group-hover:text-black transition-colors" />
        </div>
        
        <h3 className="text-lg font-medium text-zinc-900 mb-2">
          {isDragging ? '拖放到这里' : '点击或拖拽上传文件'}
        </h3>
        <p className="text-sm text-zinc-400 px-8">
          {storageType === StorageType.LOCAL_FILE && `文件将暂存到服务器，${defaultExpireDays}天后自动删除。`}
          <br />
          最大上传文件大小: {getSettings().maxFileSizeMB || 100}MB
        </p>
      </div>

      {/* 免责声明 */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
        <div className="font-semibold mb-2">免责声明</div>
        <div className="space-y-1 text-gray-500 leading-relaxed">
          <p>• 本服务仅提供文件传输功能，不保证文件的存储时间，文件可能因系统维护、存储空间限制或其他原因被提前删除。</p>
          <p>• 请勿上传涉及隐私、敏感或违法的内容，服务提供者不对用户上传的文件内容负责。</p>
          <p>• 建议及时下载文件，服务提供者不对因文件丢失、损坏或无法访问造成的任何损失承担责任。</p>
          <p>• 使用本服务即表示您已阅读并同意以上免责条款。</p>
        </div>
      </div>

      {isUploading && (
        <div className="mt-8">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-zinc-900">{uploadStatus || '上传中...'}</p>
                <p className="text-sm font-semibold text-zinc-600">{uploadProgress}%</p>
              </div>
              <div className="w-full bg-zinc-100 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-black h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
            <div className="flex items-center justify-center text-xs text-zinc-400">
              <div className="inline-block w-3 h-3 border-2 border-zinc-200 border-t-black rounded-full animate-spin mr-2"></div>
              请稍候，文件正在上传
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 text-center">
          {error}
        </div>
      )}
    </div>
  );
};