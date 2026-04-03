/**
 * Vite 配置 —— 仅用于渲染进程（React UI）。
 *
 * 主进程和 preload 脚本由 tsc 编译，不走 Vite。
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Copy pdf.js CMap and standard font files to the build output.
 * These are loaded at runtime by pdf.js for correct text rendering.
 */
function copyPdfjsAssets(): Plugin {
  const assetMappings = [
    { from: 'node_modules/pdfjs-dist/cmaps', to: 'pdfjs/cmaps' },
    { from: 'node_modules/pdfjs-dist/standard_fonts', to: 'pdfjs/standard_fonts' },
    { from: 'node_modules/pdfjs-dist/wasm', to: 'pdfjs/wasm' },
  ];

  return {
    name: 'copy-pdfjs-assets',

    // Dev mode: serve pdfjs assets from node_modules via middleware
    configureServer(server) {
      for (const { from, to } of assetMappings) {
        const srcDir = path.resolve(__dirname, from);
        server.middlewares.use(`/${to}`, (req, res, next) => {
          const fileName = req.url?.replace(/^\//, '').split('?')[0];
          if (!fileName) return next();
          const filePath = path.join(srcDir, fileName);
          if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath);
            const mime = ext === '.bcmap' ? 'application/octet-stream' : 'application/octet-stream';
            res.setHeader('Content-Type', mime);
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      }
    },

    // Production: copy files to build output
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist/renderer');
      for (const { from, to } of assetMappings) {
        const srcDir = path.resolve(__dirname, from);
        const destDir = path.resolve(outDir, to);
        if (!fs.existsSync(srcDir)) continue;
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          const srcFile = path.join(srcDir, file);
          if (fs.statSync(srcFile).isFile()) {
            fs.copyFileSync(srcFile, path.join(destDir, file));
          }
        }
      }
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',

  plugins: [react(), copyPdfjsAssets()],

  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@electron': path.resolve(__dirname, 'src/electron'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared-types': path.resolve(__dirname, 'src/shared-types'),
    },
  },

  build: {
    target: 'es2024',
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
