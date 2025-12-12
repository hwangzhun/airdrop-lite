const path = require('path');

module.exports = {
  apps: [{
    name: 'airdrop-lite',
    script: path.join(__dirname, 'server.cjs'),
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // 生产环境建议设置为具体域名，多个域名用逗号分隔
      // 例如: ALLOWED_ORIGINS: 'https://yourdomain.com,https://www.yourdomain.com'
      ALLOWED_ORIGINS: '*'
    },
    error_file: path.join(__dirname, 'logs', 'err.log'),
    out_file: path.join(__dirname, 'logs', 'out.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    // 如果服务器有多个 CPU 核心，可以启用集群模式
    // instances: 'max',
    // exec_mode: 'cluster'
  }]
};

