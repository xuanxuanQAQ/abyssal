/**
 * Vite 配置 —— 仅用于渲染进程（React UI）。
 *
 * 主进程和 preload 脚本由 tsc 编译，不走 Vite。
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',

  plugins: [react()],

  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@electron': path.resolve(__dirname, 'src/electron'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared-types': path.resolve(__dirname, 'src/shared-types'),
    },
  },

  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyDir: true,
    sourcemap: true,
    rollupOptions: {
      // 不把 electron 相关模块打进 bundle
      external: ['electron'],
    },
  },

  server: {
    port: 5173,
    strictPort: true,
  },
});
