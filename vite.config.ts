import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isProduction = mode === 'production';
    
    // 读取 package.json 获取版本号
    const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
    const version = packageJson.version;
    
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        // 输出目录
        outDir: 'dist',
        // 生成 source map（生产环境建议关闭以减小体积）
        sourcemap: !isProduction,
        // 构建后是否生成 manifest.json
        manifest: false,
        // 启用/禁用 CSS 代码拆分
        cssCodeSplit: true,
        // 构建时清空输出目录
        emptyOutDir: true,
        // 压缩配置
        minify: isProduction ? 'esbuild' : false,
        // chunk 大小警告限制（kb）
        chunkSizeWarningLimit: 1000,
        // 代码分割配置
        rollupOptions: {
          output: {
            // 手动分包策略
            manualChunks: (id) => {
              // 将 node_modules 中的依赖单独打包
              if (id.includes('node_modules')) {
                // React 相关库单独打包
                if (id.includes('react') || id.includes('react-dom')) {
                  return 'react-vendor';
                }
                // 其他第三方库打包到一起
                return 'vendor';
              }
            },
            // 输出文件命名
            chunkFileNames: 'assets/js/[name]-[hash].js',
            entryFileNames: 'assets/js/[name]-[hash].js',
            assetFileNames: (assetInfo) => {
              // 根据文件类型分类输出
              const info = assetInfo.name.split('.');
              const ext = info[info.length - 1];
              if (/\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/i.test(assetInfo.name)) {
                return 'assets/media/[name]-[hash].[ext]';
              }
              if (/\.(png|jpe?g|gif|svg|webp|avif)(\?.*)?$/i.test(assetInfo.name)) {
                return 'assets/images/[name]-[hash].[ext]';
              }
              if (/\.(woff2?|eot|ttf|otf)(\?.*)?$/i.test(assetInfo.name)) {
                return 'assets/fonts/[name]-[hash].[ext]';
              }
              if (ext === 'css') {
                return 'assets/css/[name]-[hash].[ext]';
              }
              return 'assets/[name]-[hash].[ext]';
            },
          },
        },
        // 提高构建性能
        target: 'es2015',
        // 启用 gzip 压缩大小报告（需要安装 rollup-plugin-visualizer）
        reportCompressedSize: true,
      },
      // 生产环境优化
      esbuild: {
        // 生产环境移除 console 和 debugger
        drop: isProduction ? ['console', 'debugger'] : [],
      },
    };
});
