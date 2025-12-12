// 生产环境使用相对路径，开发环境使用 localhost
const AUTH_API_BASE = import.meta.env.DEV 
  ? 'http://localhost:3001/api/auth'
  : '/api/auth';

// 验证密码（登录）
export const verifyPassword = async (password: string): Promise<boolean> => {
  try {
    const response = await fetch(`${AUTH_API_BASE}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // 重要：包含 cookie
      body: JSON.stringify({ password })
    });
    
    if (response.ok) {
      return true;
    } else {
      const data = await response.json();
      throw new Error(data.error || '密码验证失败');
    }
  } catch (error: any) {
    if (error.message) {
      throw error;
    }
    throw new Error('网络错误，请检查后端服务是否运行');
  }
};

// 检查登录状态
export const checkAuth = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${AUTH_API_BASE}/check`, {
      method: 'GET',
      credentials: 'include' // 重要：包含 cookie
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.authenticated === true;
    }
    return false;
  } catch (error) {
    // 网络错误时返回 false，不抛出异常
    console.error('检查登录状态失败:', error);
    return false;
  }
};

// 登出
export const logout = async (): Promise<void> => {
  try {
    await fetch(`${AUTH_API_BASE}/logout`, {
      method: 'POST',
      credentials: 'include' // 重要：包含 cookie
    });
  } catch (error) {
    // 即使网络错误也继续，因为前端状态会清除
    console.error('登出请求失败:', error);
  }
};

// 修改密码
export const changePassword = async (oldPassword: string, newPassword: string): Promise<void> => {
  try {
    const response = await fetch(`${AUTH_API_BASE}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // 重要：包含 cookie
      body: JSON.stringify({ oldPassword, newPassword })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || '修改密码失败');
    }
  } catch (error: any) {
    if (error.message) {
      throw error;
    }
    throw new Error('网络错误，请检查后端服务是否运行');
  }
};

