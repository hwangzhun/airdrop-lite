import React, { useState, useEffect, useRef } from 'react';
import { getAllFiles, deleteFile, getSettings, saveSettings } from '../services/storageService';
import { verifyPassword, changePassword, checkAuth, logout } from '../services/authService';
import { FileRecord, AppSettings, StorageType } from '../types';
import { FileIcon, TrashIcon, ShieldIcon, XIcon, UploadIcon, DownloadIcon, CheckIcon } from '../components/Icons';
import { logger, LogLevel, LogEntry } from '../services/logger';

export const AdminView: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
      storageLimitMB: 100,
      allowPublicUploads: true,
      installDate: Date.now(),
      storageType: StorageType.LOCAL_FILE,
      maxFileSizeMB: 100,
      defaultExpireDays: 7,
      ossConfig: { endpoint: '', bucket: '', region: '', accessKeyId: '', accessKeySecret: '' }
  });
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [uptime, setUptime] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'settings' | 'logs'>('files');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  // 日志相关状态
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logSource, setLogSource] = useState<'frontend' | 'backend'>('frontend');
  const [backendLogs, setBackendLogs] = useState<string[]>([]);
  const [logFilter, setLogFilter] = useState<{ level?: LogLevel; keyword?: string; startTime?: Date; endTime?: Date }>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [logStats, setLogStats] = useState(logger.getLogStats());
  const [backendLogStats, setBackendLogStats] = useState<any>(null);
  const [logLevel, setLogLevel] = useState<LogLevel>(logger.getLogStats ? LogLevel.DEBUG : LogLevel.INFO);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [copiedItem, setCopiedItem] = useState<{ fileId: string; type: 'code' | 'hash' } | null>(null);
  const [copiedPreviewHash, setCopiedPreviewHash] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // 页面加载时检查登录状态
  useEffect(() => {
    const checkLoginStatus = async () => {
      try {
        const authenticated = await checkAuth();
        setIsAuthenticated(authenticated);
      } catch (error) {
        console.error('检查登录状态失败:', error);
        setIsAuthenticated(false);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    
    checkLoginStatus();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
      const interval = setInterval(updateUptime, 1000); // Update every second
      updateUptime(); // Initial call
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  // 日志相关effect
  useEffect(() => {
    if (isAuthenticated && activeTab === 'logs') {
      loadLogs();
      if (autoRefresh) {
        const interval = setInterval(loadLogs, 2000); // 每2秒刷新一次
        return () => clearInterval(interval);
      }
    }
  }, [isAuthenticated, activeTab, logFilter, autoRefresh, logSource]);

  // 初始化日志级别
  useEffect(() => {
    const stored = localStorage.getItem('airdrop_lite_log_level');
    if (stored) {
      const level = parseInt(stored);
      if (level >= 0 && level <= 4) {
        setLogLevel(level);
        logger.setLevel(level);
      }
    }
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const list = await getAllFiles();
      setFiles(list);
      // 尝试从后端同步设置
      const { syncSettingsFromBackend } = await import('../services/storageService');
      const currentSettings = await syncSettingsFromBackend();
      setSettings(currentSettings);
    } catch (error: any) {
      console.error('加载文件失败:', error);
      alert(error.message || '加载文件失败');
    } finally {
      setIsLoading(false);
    }
  };

  const updateUptime = () => {
    const start = getSettings().installDate || Date.now();
    const now = Date.now();
    const diff = now - start;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    setUptime(`${days}天 ${hours}小时 ${minutes}分钟 ${seconds}秒`);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isValid = await verifyPassword(password);
      if (isValid) {
        setIsAuthenticated(true);
        setPassword(''); // 清空密码
      }
    } catch (error: any) {
      alert(error.message || '登录失败，请检查后端服务是否运行');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('新密码和确认密码不一致');
      return;
    }
    
    if (passwordForm.newPassword.length < 6) {
      alert('新密码长度至少6位');
      return;
    }

    try {
      setIsChangingPassword(true);
      await changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      alert('密码修改成功');
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setIsChangingPassword(false);
    } catch (error: any) {
      alert(error.message || '修改密码失败');
      setIsChangingPassword(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('确定删除此文件吗？')) {
      try {
        await deleteFile(id);
        await loadData();
      if (previewFile?.id === id) setPreviewFile(null);
      } catch (error: any) {
        alert(`删除失败: ${error.message || '未知错误'}`);
      }
    }
  };

  const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    
    // Handle nested OSS config
    if (name.startsWith('oss_')) {
        const field = name.replace('oss_', '');
        const newSettings = {
            ...settings,
            ossConfig: {
                ...settings.ossConfig,
                [field]: value
            }
        };
        setSettings(newSettings);
        // 重置保存状态，表示有未保存的更改
        if (saveStatus === 'saved') {
          setSaveStatus('idle');
        }
    } else {
        // Handle root settings
        const newSettings = {
            ...settings,
            [name]: type === 'checkbox' ? checked : (type === 'number' ? Number(value) : value)
        };
        setSettings(newSettings);
        // 重置保存状态，表示有未保存的更改
        if (saveStatus === 'saved') {
          setSaveStatus('idle');
        }
    }
  };

  const handleApplySettings = async () => {
    try {
      setSaveStatus('saving');
      await saveSettings(settings);
      setSaveStatus('saved');
      // 3秒后自动清除"已保存"提示
      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
    } catch (error: any) {
      console.error('保存设置失败:', error);
      setSaveStatus('error');
      alert(error.message || '保存设置失败');
      // 3秒后清除错误状态
      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
    }
  };

  const handleCopy = async (text: string, fileId: string, type: 'code' | 'hash') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem({ fileId, type });
      setTimeout(() => setCopiedItem(null), 2000);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedItem({ fileId, type });
        setTimeout(() => setCopiedItem(null), 2000);
      } catch (err) {
        alert('复制失败，请手动复制');
      }
      document.body.removeChild(textArea);
    }
  };

  const handleCopyPreviewHash = async () => {
    if (!previewFile) return;
    try {
      await navigator.clipboard.writeText(previewFile.hash);
      setCopiedPreviewHash(true);
      setTimeout(() => setCopiedPreviewHash(false), 2000);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = previewFile.hash;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedPreviewHash(true);
        setTimeout(() => setCopiedPreviewHash(false), 2000);
      } catch (err) {
        alert('复制失败，请手动复制');
      }
      document.body.removeChild(textArea);
    }
  };

  // 日志相关函数
  const loadLogs = async () => {
    if (logSource === 'frontend') {
      const filteredLogs = logger.getLogs(logFilter);
      setLogs(filteredLogs);
      setLogStats(logger.getLogStats());
    } else {
      // 加载后端日志
      try {
        const logs = await logger.getBackendLogs({
          startDate: logFilter.startTime,
          endDate: logFilter.endTime,
          level: logFilter.level,
          keyword: logFilter.keyword,
          limit: 500,
          source: 'cached'
        });
        setBackendLogs(logs);
        
        // 获取后端日志统计
        const stats = await logger.getBackendLogStats();
        setBackendLogStats(stats);
      } catch (error) {
        console.error('加载后端日志失败:', error);
      }
    }
    
    // 自动滚动到底部
    if (logContainerRef.current && autoRefresh) {
      setTimeout(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      }, 100);
    }
  };

  const handleLogLevelChange = (level: LogLevel) => {
    setLogLevel(level);
    logger.setLevel(level);
    localStorage.setItem('airdrop_lite_log_level', String(level));
  };

  const handleExportLogs = (format: 'text' | 'json') => {
    const content = format === 'text' 
      ? logger.exportLogs(logFilter)
      : logger.exportLogsJSON(logFilter);
    
    const blob = new Blob([content], { 
      type: format === 'json' ? 'application/json' : 'text/plain' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().split('T')[0]}.${format === 'json' ? 'json' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = () => {
    if (window.confirm('确定要清空所有日志吗？此操作不可恢复。')) {
      logger.clearLogs();
      loadLogs();
      alert('日志已清空');
    }
  };

  const getLogLevelColor = (level: LogLevel) => {
    switch (level) {
      case LogLevel.DEBUG:
        return { badge: 'text-zinc-400 bg-zinc-100', bg: 'bg-zinc-50/50 border-zinc-200' };
      case LogLevel.INFO:
        return { badge: 'text-blue-600 bg-blue-50', bg: 'bg-blue-50/30 border-blue-200' };
      case LogLevel.WARN:
        return { badge: 'text-yellow-600 bg-yellow-50', bg: 'bg-yellow-50/30 border-yellow-200' };
      case LogLevel.ERROR:
        return { badge: 'text-red-600 bg-red-50', bg: 'bg-red-50/30 border-red-200' };
      default:
        return { badge: 'text-zinc-600 bg-zinc-50', bg: 'bg-zinc-50/30 border-zinc-200' };
    }
  };


  // Stats Calculations
  const totalFiles = files.length;
  const totalStorage = (files.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(2);
  const totalDownloads = files.reduce((acc, f) => acc + (f.downloadCount || 0), 0);

  // 正在检查登录状态时显示加载
  if (isCheckingAuth) {
    return (
      <div className="max-w-xs mx-auto pt-20 text-center">
        <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldIcon className="w-8 h-8 text-zinc-900" />
        </div>
        <p className="text-zinc-500">检查登录状态...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-xs mx-auto pt-20 text-center">
        <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldIcon className="w-8 h-8 text-zinc-900" />
        </div>
        <h2 className="text-xl font-bold text-zinc-900 mb-6">管理员登录</h2>
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="密码"
            className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 focus:outline-none focus:border-black"
          />
          <button type="submit" className="w-full bg-black text-white py-3 rounded-xl font-medium hover:bg-zinc-800">
            登录
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-zinc-900">控制台</h2>
        <button 
          onClick={async () => {
            await logout();
            setIsAuthenticated(false);
          }} 
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          退出登录
        </button>
      </div>

      {/* 1. Statistics Panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm">
           <div className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">托管文件</div>
           <div className="text-2xl font-bold text-zinc-900">{totalFiles} <span className="text-sm font-normal text-zinc-400">个</span></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm">
           <div className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">存储占用</div>
           <div className="text-2xl font-bold text-zinc-900">{totalStorage} <span className="text-sm font-normal text-zinc-400">MB</span></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm">
           <div className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">总下载次数</div>
           <div className="text-2xl font-bold text-zinc-900">{totalDownloads} <span className="text-sm font-normal text-zinc-400">次</span></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm">
           <div className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">系统运行</div>
           <div className="text-lg font-bold text-zinc-900 leading-8 truncate" title={uptime}>{uptime || "刚刚"}</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 bg-white/50 backdrop-blur-sm p-1.5 rounded-full border border-zinc-200/60 shadow-sm inline-flex space-x-1">
        <button
          onClick={() => setActiveTab('files')}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
            activeTab === 'files' 
              ? 'bg-black text-white shadow-md' 
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          文件管理
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
            activeTab === 'settings' 
              ? 'bg-black text-white shadow-md' 
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          基础设置
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
            activeTab === 'logs' 
              ? 'bg-black text-white shadow-md' 
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          系统日志
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'files' && (
        <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                    <h3 className="font-semibold text-zinc-900">文件管理</h3>
                </div>
                
                {isLoading ? (
                  <div className="p-12 text-center text-zinc-400">加载中...</div>
                ) : files.length === 0 ? (
                <div className="p-12 text-center text-zinc-400">暂无文件。</div>
                ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-100">
                        <tr>
                        <th className="px-5 py-3 font-medium whitespace-nowrap">文件名</th>
                        <th className="px-5 py-3 font-medium whitespace-nowrap">验证码</th>
                        <th className="px-5 py-3 font-medium whitespace-nowrap">哈希值</th>
                        <th className="px-5 py-3 font-medium whitespace-nowrap">下载</th>
                        <th className="px-5 py-3 font-medium whitespace-nowrap">大小</th>
                        <th className="px-5 py-3 font-medium whitespace-nowrap">过期时间</th>
                        <th className="px-5 py-3 font-medium text-right whitespace-nowrap">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                        {files.map(file => (
                        <tr key={file.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-5 py-3 text-zinc-900 max-w-[150px] truncate" title={file.name}>
                                <div className="flex items-center gap-2">
                                    {file.type.startsWith('image/') ? (
                                        <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" title="图片"></span>
                                    ) : (
                                        <span className="w-2 h-2 rounded-full bg-zinc-300 shrink-0" title="文件"></span>
                                    )}
                                    <span className="truncate">{file.name}</span>
                                </div>
                            </td>
                            <td className="px-5 py-3">
                                <div 
                                    onClick={() => handleCopy(file.code, file.id, 'code')}
                                    className="font-mono text-zinc-900 font-semibold tracking-wider cursor-pointer hover:text-black hover:bg-zinc-100 px-2 py-1 rounded transition-colors relative inline-block"
                                    title="点击复制验证码"
                                >
                                    {file.code}
                                    {copiedItem?.fileId === file.id && copiedItem?.type === 'code' && (
                                        <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50 pointer-events-none">
                                            已复制
                                        </span>
                                    )}
                                </div>
                            </td>
                            <td className="px-5 py-3">
                                <div 
                                    onClick={() => handleCopy(file.hash, file.id, 'hash')}
                                    className="font-mono text-xs text-zinc-600 max-w-[200px] truncate cursor-pointer hover:text-black hover:bg-zinc-100 px-2 py-1 rounded transition-colors relative inline-block"
                                    title="点击复制哈希值"
                                >
                                    {file.hash}
                                    {copiedItem?.fileId === file.id && copiedItem?.type === 'hash' && (
                                        <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50 pointer-events-none">
                                            已复制
                                        </span>
                                    )}
                                </div>
                            </td>
                            <td className="px-5 py-3 font-mono text-zinc-600">{file.downloadCount || 0}</td>
                            <td className="px-5 py-3 text-zinc-500 whitespace-nowrap">{(file.size / 1024).toFixed(1)} KB</td>
                            <td className="px-5 py-3 text-zinc-500 whitespace-nowrap text-xs">
                                {file.expireDate 
                                    ? (
                                        <span className={file.expireDate <= Date.now() ? 'text-red-500' : ''}>
                                            {new Date(file.expireDate).toLocaleString('zh-CN')}
                                            {file.expireDate <= Date.now() && (
                                                <span className="ml-1 text-red-500">（已过期）</span>
                                            )}
                                        </span>
                                    )
                                    : <span className="text-zinc-400">永不过期</span>
                                }
                            </td>
                            <td className="px-5 py-3 text-right space-x-3 whitespace-nowrap">
                            <button 
                                onClick={() => setPreviewFile(file)}
                                className="text-zinc-400 hover:text-black font-medium text-xs"
                            >
                                预览
                            </button>
                            <button 
                                onClick={() => handleDelete(file.id)}
                                className="text-red-400 hover:text-red-600 text-xs"
                            >
                                删除
                            </button>
                            </td>
                        </tr>
                        ))}
                    </tbody>
                    </table>
                </div>
                )}
            </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="max-w-2xl space-y-6">
             {/* General Settings */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                        <span>基础设置</span>
                    </h3>
                    <div className="flex items-center gap-3">
                        {/* 状态提示 */}
                        {saveStatus === 'saving' && (
                            <span className="text-xs text-zinc-500 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-pulse"></span>
                                保存中...
                            </span>
                        )}
                        {saveStatus === 'saved' && (
                            <span className="text-xs text-green-600 flex items-center gap-1.5">
                                <CheckIcon className="w-3.5 h-3.5" />
                                已保存
                            </span>
                        )}
                        {saveStatus === 'error' && (
                            <span className="text-xs text-red-500 flex items-center gap-1.5">
                                <XIcon className="w-3.5 h-3.5" />
                                保存失败
                            </span>
                        )}
                        {/* 应用按钮 */}
                        <button
                            onClick={handleApplySettings}
                            disabled={saveStatus === 'saving'}
                            className="px-4 py-1.5 bg-black text-white text-sm font-medium rounded-lg hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {saveStatus === 'saving' ? '保存中...' : '应用'}
                        </button>
                    </div>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                        存储方式
                        </label>
                        <select
                        name="storageType"
                        value={settings.storageType || StorageType.LOCAL_FILE}
                        onChange={handleSettingChange}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black"
                        >
                            <option value={StorageType.LOCAL_FILE}>本地文件 (uploadfiles文件夹)</option>
                            <option value={StorageType.OSS}>OSS对象存储</option>
                        </select>
                        <p className="text-xs text-zinc-400 mt-1.5">
                            {settings.storageType === StorageType.LOCAL_FILE && '文件存储到uploadfiles文件夹，需要后端API支持'}
                            {settings.storageType === StorageType.OSS && '文件上传到OSS对象存储，需要配置OSS信息'}
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                        存储限制 (MB)
                        </label>
                        <input
                        type="number"
                        name="storageLimitMB"
                        value={settings.storageLimitMB}
                        onChange={handleSettingChange}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                        最大文件大小 (MB)
                        </label>
                        <input
                        type="number"
                        name="maxFileSizeMB"
                        value={settings.maxFileSizeMB || 100}
                        onChange={handleSettingChange}
                        min="1"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black"
                        />
                        <p className="text-xs text-zinc-400 mt-1.5">
                            单个文件上传的最大大小限制
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                        默认过期天数
                        </label>
                        <input
                        type="number"
                        name="defaultExpireDays"
                        value={settings.defaultExpireDays || 7}
                        onChange={handleSettingChange}
                        min="0"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black"
                        />
                        <p className="text-xs text-zinc-400 mt-1.5">
                            0 表示永不过期，文件将在指定天数后自动删除
                        </p>
                    </div>
                    <div className="flex items-center pt-2">
                        <label className="flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            name="allowPublicUploads"
                            checked={settings.allowPublicUploads}
                            onChange={handleSettingChange}
                            className="w-4 h-4 text-black rounded focus:ring-black accent-black"
                        />
                        <span className="ml-3 text-sm text-zinc-700 font-medium">允许公开上传</span>
                        </label>
                    </div>
                </div>
            </div>

            {/* OSS Settings */}
            {settings.storageType === StorageType.OSS && (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100">
                <h3 className="font-semibold text-zinc-900 mb-4 flex items-center gap-2">
                    <span>OSS 对象存储设置</span>
                    <span className="bg-purple-100 text-purple-600 text-[10px] px-2 py-0.5 rounded-full font-medium">必需</span>
                </h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                        Endpoint (地域节点)
                        </label>
                        <input
                        type="text"
                        name="oss_endpoint"
                        value={settings.ossConfig?.endpoint || ''}
                        onChange={handleSettingChange}
                        placeholder="oss-cn-hangzhou.aliyuncs.com"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black placeholder-zinc-300"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                        Bucket Name
                        </label>
                        <input
                        type="text"
                        name="oss_bucket"
                        value={settings.ossConfig?.bucket || ''}
                        onChange={handleSettingChange}
                        placeholder="my-storage-bucket"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black placeholder-zinc-300"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                        Access Key ID
                        </label>
                        <input
                        type="password"
                        name="oss_accessKeyId"
                        value={settings.ossConfig?.accessKeyId || ''}
                        onChange={handleSettingChange}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                        Access Key Secret
                        </label>
                        <input
                        type="password"
                        name="oss_accessKeySecret"
                        value={settings.ossConfig?.accessKeySecret || ''}
                        onChange={handleSettingChange}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black"
                        />
                    </div>
                </div>
            </div>
            )}

            {/* Password Change Settings */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100">
                <h3 className="font-semibold text-zinc-900 mb-4 flex items-center gap-2">
                    <ShieldIcon className="w-4 h-4" />
                    <span>修改管理员密码</span>
                </h3>
                <form onSubmit={handleChangePassword} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                        原密码
                        </label>
                        <input
                        type="password"
                        value={passwordForm.oldPassword}
                        onChange={e => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                        placeholder="请输入原密码"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black placeholder-zinc-300"
                        required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                        新密码
                        </label>
                        <input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                        placeholder="至少6位字符"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black placeholder-zinc-300"
                        required
                        minLength={6}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                        确认新密码
                        </label>
                        <input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                        placeholder="请再次输入新密码"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-black placeholder-zinc-300"
                        required
                        minLength={6}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isChangingPassword}
                        className="w-full bg-black text-white py-2.5 rounded-lg font-medium hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isChangingPassword ? '修改中...' : '修改密码'}
                    </button>
                </form>
            </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="space-y-6">
          {/* 日志统计和操作栏 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-zinc-900">系统日志</h3>
              <div className="flex items-center gap-3 flex-wrap">
                {/* 日志源切换 */}
                <div className="flex items-center gap-2 bg-zinc-100 rounded-lg p-1">
                  <button
                    onClick={() => setLogSource('frontend')}
                    className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                      logSource === 'frontend'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    前端日志
                  </button>
                  <button
                    onClick={() => setLogSource('backend')}
                    className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                      logSource === 'backend'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    后端日志
                  </button>
                </div>
                {/* 日志级别配置（仅前端） */}
                {logSource === 'frontend' && (
                  <select
                    value={logLevel}
                    onChange={(e) => handleLogLevelChange(Number(e.target.value) as LogLevel)}
                    className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-black"
                  >
                    <option value={LogLevel.DEBUG}>DEBUG</option>
                    <option value={LogLevel.INFO}>INFO</option>
                    <option value={LogLevel.WARN}>WARN</option>
                    <option value={LogLevel.ERROR}>ERROR</option>
                    <option value={LogLevel.NONE}>NONE</option>
                  </select>
                )}
                <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="w-4 h-4 text-black rounded focus:ring-black accent-black"
                  />
                  自动刷新
                </label>
                <button
                  onClick={loadLogs}
                  className="px-3 py-1.5 bg-zinc-100 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors"
                >
                  刷新
                </button>
                <div className="flex gap-2">
                  {logSource === 'frontend' && (
                    <>
                      <button
                        onClick={() => handleExportLogs('text')}
                        className="px-3 py-1.5 bg-zinc-100 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors"
                      >
                        导出TXT
                      </button>
                      <button
                        onClick={() => handleExportLogs('json')}
                        className="px-3 py-1.5 bg-zinc-100 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors"
                      >
                        导出JSON
                      </button>
                      <button
                        onClick={handleClearLogs}
                        className="px-3 py-1.5 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors"
                      >
                        清空日志
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 统计信息 */}
            {logSource === 'frontend' ? (
              <div className="grid grid-cols-5 gap-4 mb-4">
                <div className="bg-zinc-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-zinc-500 mb-1">总计</div>
                  <div className="text-lg font-bold text-zinc-900">{logStats.total}</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-blue-600 mb-1">INFO</div>
                  <div className="text-lg font-bold text-blue-900">{logStats.byLevel[LogLevel.INFO] || 0}</div>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-yellow-600 mb-1">WARN</div>
                  <div className="text-lg font-bold text-yellow-900">{logStats.byLevel[LogLevel.WARN] || 0}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-red-600 mb-1">ERROR</div>
                  <div className="text-lg font-bold text-red-900">{logStats.byLevel[LogLevel.ERROR] || 0}</div>
                </div>
                <div className="bg-zinc-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-zinc-500 mb-1">DEBUG</div>
                  <div className="text-lg font-bold text-zinc-900">{logStats.byLevel[LogLevel.DEBUG] || 0}</div>
                </div>
              </div>
            ) : (
              backendLogStats && (
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-zinc-50 rounded-lg p-3 text-center">
                    <div className="text-xs text-zinc-500 mb-1">缓存日志</div>
                    <div className="text-lg font-bold text-zinc-900">{backendLogStats.cacheSize || 0}</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <div className="text-xs text-blue-600 mb-1">日志文件数</div>
                    <div className="text-lg font-bold text-blue-900">{backendLogStats.totalLogFiles || 0}</div>
                  </div>
                  <div className="bg-zinc-50 rounded-lg p-3 text-center">
                    <div className="text-xs text-zinc-500 mb-1">当前文件大小</div>
                    <div className="text-lg font-bold text-zinc-900">
                      {backendLogStats.logFileSize 
                        ? `${(backendLogStats.logFileSize / 1024 / 1024).toFixed(2)} MB`
                        : '0 MB'}
                    </div>
                  </div>
                </div>
              )
            )}

            {/* 过滤栏 */}
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={logFilter.level !== undefined ? logFilter.level : ''}
                onChange={(e) => setLogFilter({ 
                  ...logFilter, 
                  level: e.target.value === '' ? undefined : Number(e.target.value) 
                })}
                className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-black"
              >
                <option value="">所有级别</option>
                <option value={LogLevel.DEBUG}>DEBUG</option>
                <option value={LogLevel.INFO}>INFO</option>
                <option value={LogLevel.WARN}>WARN</option>
                <option value={LogLevel.ERROR}>ERROR</option>
              </select>
              <input
                type="text"
                placeholder="搜索关键词..."
                value={logFilter.keyword || ''}
                onChange={(e) => setLogFilter({ ...logFilter, keyword: e.target.value || undefined })}
                className="flex-1 min-w-[200px] px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-black"
              />
              <input
                type="datetime-local"
                placeholder="开始时间"
                value={logFilter.startTime ? new Date(logFilter.startTime.getTime() - logFilter.startTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                onChange={(e) => setLogFilter({ 
                  ...logFilter, 
                  startTime: e.target.value ? new Date(e.target.value) : undefined 
                })}
                className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-black"
              />
              <input
                type="datetime-local"
                placeholder="结束时间"
                value={logFilter.endTime ? new Date(logFilter.endTime.getTime() - logFilter.endTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                onChange={(e) => setLogFilter({ 
                  ...logFilter, 
                  endTime: e.target.value ? new Date(e.target.value) : undefined 
                })}
                className="px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-black"
              />
              <button
                onClick={() => setLogFilter({})}
                className="px-3 py-1.5 bg-zinc-100 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors"
              >
                清除筛选
              </button>
            </div>
          </div>

          {/* 日志列表 */}
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/50">
              <h3 className="font-semibold text-zinc-900">
                日志记录 ({logSource === 'frontend' ? logs.length : backendLogs.length} 条)
              </h3>
            </div>
            <div 
              ref={logContainerRef}
              className="overflow-y-auto max-h-[600px] p-4 space-y-2 bg-zinc-50/30"
            >
              {logSource === 'frontend' ? (
                logs.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400">暂无日志记录</div>
                ) : (
                  logs.map((log, index) => {
                    const colors = getLogLevelColor(log.level);
                    return (
                    <div
                      key={index}
                      className={`p-3 rounded-lg border hover:shadow-sm transition-all ${colors.bg}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${colors.badge}`}>
                          {log.levelName}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                            <span>{new Date(log.timestamp).toLocaleString('zh-CN')}</span>
                            {log.callerInfo && (
                              <>
                                <span>•</span>
                                <span className="font-mono">{log.callerInfo}</span>
                              </>
                            )}
                            {log.performance && (
                              <>
                                <span>•</span>
                                <span className="font-semibold">
                                  性能: {log.performance.duration?.toFixed(2)}ms
                                </span>
                              </>
                            )}
                          </div>
                          <div className="text-sm text-zinc-900 break-words">{log.message}</div>
                          {log.args && log.args.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-700">
                                查看详细信息
                              </summary>
                              <pre className="mt-2 p-2 bg-zinc-50 rounded text-xs overflow-x-auto">
                                {JSON.stringify(log.args, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                  })
                )
              ) : (
                backendLogs.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400">暂无后端日志记录</div>
                ) : (
                  backendLogs.map((logLine, index) => {
                    // 解析后端日志格式：[时间] [级别] [来源] 消息
                    const match = logLine.match(/\[(.*?)\] \[(.*?)\](?: \[(.*?)\])? (.*)/);
                    if (match) {
                      const [, timestamp, levelName, callerInfo, message] = match;
                      const level = levelName === 'ERROR' ? LogLevel.ERROR :
                                   levelName === 'WARN' ? LogLevel.WARN :
                                   levelName === 'INFO' ? LogLevel.INFO : LogLevel.DEBUG;
                      const colors = getLogLevelColor(level);
                      return (
                        <div
                          key={index}
                          className={`p-3 rounded-lg border hover:shadow-sm transition-all ${colors.bg}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${colors.badge}`}>
                              {levelName}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                                <span>{timestamp}</span>
                                {callerInfo && (
                                  <>
                                    <span>•</span>
                                    <span className="font-mono">{callerInfo}</span>
                                  </>
                                )}
                              </div>
                              <div className="text-sm text-zinc-900 break-words">{message}</div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={index} className="p-3 rounded-lg border bg-zinc-50/50 border-zinc-200">
                        <div className="text-sm text-zinc-900 break-words font-mono text-xs">{logLine}</div>
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <div 
          className="fixed inset-0 bg-black/10 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            // 点击背景关闭窗口
            if (e.target === e.currentTarget) {
              setPreviewFile(null);
            }
          }}
        >
          <div 
            className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b border-zinc-100">
              <h4 className="font-semibold text-zinc-900 truncate pr-4">{previewFile.name}</h4>
              <button onClick={() => setPreviewFile(null)} className="text-zinc-400 hover:text-zinc-900">
                <XIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="bg-zinc-50 aspect-video flex items-center justify-center relative">
              {previewFile.type.startsWith('image/') ? (
                <img 
                  src={previewFile.data} 
                  alt="Preview" 
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    // Fallback for OSS/localFile URLs that might have CORS issues
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              ) : (
                <div className="text-center text-zinc-400">
                  <FileIcon className="w-16 h-16 mx-auto mb-2" />
                  <p>无法预览</p>
                </div>
              )}
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <div className="text-[10px] uppercase text-zinc-400 font-bold tracking-wider mb-1">哈希值</div>
                <div 
                  onClick={handleCopyPreviewHash}
                  className="text-xs font-mono text-zinc-600 bg-zinc-50 p-2 rounded break-all border border-zinc-100 cursor-pointer hover:text-black hover:bg-zinc-100 transition-colors relative"
                  title="点击复制哈希值"
                >
                  {previewFile.hash}
                  {copiedPreviewHash && (
                    <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50 pointer-events-none">
                      已复制
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-2 text-sm text-zinc-500">
                <div className="flex justify-between">
                  <span>下载次数: {previewFile.downloadCount || 0}</span>
                  <span>上传时间: {new Date(previewFile.uploadDate).toLocaleString('zh-CN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>过期时间:</span>
                  <span className={previewFile.expireDate && previewFile.expireDate <= Date.now() ? 'text-red-500' : ''}>
                    {previewFile.expireDate 
                      ? new Date(previewFile.expireDate).toLocaleString('zh-CN')
                      : '永不过期'
                    }
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};