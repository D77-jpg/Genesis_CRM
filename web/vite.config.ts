/**
 * Vite 配置
 * ------------------------------------------------------------------
 * - @ 别名指向 src
 * - dev server 通过 proxy 把 /api 转发到 Express，天然规避 CORS
 * - 生产构建做手动分包，避免 vendor 单文件过大
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SRC_DIR = fileURLToPath(new URL('./src', import.meta.url));

/** 后端地址，可通过环境变量 VITE_API_PROXY_TARGET 覆盖 */
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(SRC_DIR),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // 保持路径不变：前端请求 /api/customers → 后端 /api/customers
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          radix: [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-popover',
          ],
          editor: ['react-quill'],
          excel: ['xlsx'],
        },
      },
    },
  },
});
