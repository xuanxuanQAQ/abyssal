/**
 * esbuild 主进程打包配置
 *
 * 取代 tsc -p tsconfig.main.json 直接产出 dist/ 的方案。
 * - 输出 CJS（Electron 运行时需要）
 * - native 模块标记为 external（运行时 require）
 * - SQL 迁移文件作为 asset 复制
 * - __dirname 保持正确（esbuild platform=node 默认行为）
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

// ─── 复制 SQL 迁移文件 ───

function copyMigrations() {
  const src = path.join(__dirname, 'src/core/database/migrations');
  const dst = path.join(__dirname, 'dist/core/database/migrations');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.sql')) {
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
  }
}

copyMigrations();

// ─── Native 模块和 Electron 标记为 external ───

const externalModules = [
  'electron',
  'better-sqlite3',
  'mupdf',
  'tesseract.js',
  'onnxruntime-node',
  // Node.js builtins 由 platform: 'node' 自动处理
];

// ─── 构建配置 ───

/** @type {esbuild.BuildOptions} */
const mainConfig = {
  entryPoints: ['src/electron/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/electron/main.js',
  external: externalModules,
  sourcemap: true,
  // 保持 __dirname/__filename 的 Node 语义
  define: {},
  // 路径别名（与 tsconfig paths 对齐）
  alias: {
    '@core': path.join(__dirname, 'src/core'),
    '@shared-types': path.join(__dirname, 'src/shared-types'),
    '@test-utils': path.join(__dirname, 'src/__test-utils__'),
  },
  // 排除测试文件
  conditions: ['node'],
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const preloadConfig = {
  entryPoints: ['src/electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/electron/preload.js',
  external: ['electron'],
  sourcemap: true,
  alias: {
    '@shared-types': path.join(__dirname, 'src/shared-types'),
  },
};

// ─── 执行 ───

if (isWatch) {
  const mainCtx = await esbuild.context(mainConfig);
  const preloadCtx = await esbuild.context(preloadConfig);
  await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
  console.log('[esbuild] watching for changes...');
} else {
  await Promise.all([
    esbuild.build(mainConfig),
    esbuild.build(preloadConfig),
  ]);
}
