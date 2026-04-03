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

// ─── 编译 TypeScript 迁移文件 ───
// TS 迁移在运行时通过 require() 动态加载，需单独编译为 CJS

async function buildTsMigrations() {
  const migrationsDir = path.join(__dirname, 'src/core/database/migrations');
  const tsMigrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.ts'));
  if (tsMigrations.length === 0) return;

  await esbuild.build({
    entryPoints: tsMigrations.map((f) => path.join(migrationsDir, f)),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outdir: path.join(__dirname, 'dist/core/database/migrations'),
    external: externalModules,
    sourcemap: true,
    alias: {
      '@core': path.join(__dirname, 'src/core'),
      '@shared-types': path.join(__dirname, 'src/shared-types'),
    },
  });
}

copyMigrations();

// ─── Native 模块和 Electron 标记为 external ───

const externalModules = [
  'electron',
  'better-sqlite3',
  'sqlite-vec',
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
  target: 'node22',
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
const dbProcessConfig = {
  entryPoints: ['src/db-process/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/db-process/main.js',
  external: externalModules,
  sourcemap: true,
  alias: {
    '@core': path.join(__dirname, 'src/core'),
    '@shared-types': path.join(__dirname, 'src/shared-types'),
  },
  conditions: ['node'],
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const dlaProcessConfig = {
  entryPoints: ['src/dla-process/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/dla-process/main.js',
  external: externalModules,
  sourcemap: true,
  alias: {
    '@core': path.join(__dirname, 'src/core'),
    '@shared-types': path.join(__dirname, 'src/shared-types'),
  },
  conditions: ['node'],
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const preloadConfig = {
  entryPoints: ['src/electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
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
  const dbCtx = await esbuild.context(dbProcessConfig);
  const dlaCtx = await esbuild.context(dlaProcessConfig);
  await Promise.all([mainCtx.watch(), preloadCtx.watch(), dbCtx.watch(), dlaCtx.watch()]);
  await buildTsMigrations();
  copyMigrations();

  // Watch migrations directory for new/changed .ts and .sql files.
  // esbuild context.watch() only tracks import graphs — dynamically-loaded
  // migration scripts are invisible to it, so we use fs.watch as a sidecar.
  const migrationsDir = path.join(__dirname, 'src/core/database/migrations');
  let migrationRebuildTimer = null;
  fs.watch(migrationsDir, (_eventType, filename) => {
    if (!filename) return;
    if (!filename.endsWith('.ts') && !filename.endsWith('.sql')) return;
    // Debounce: coalesce rapid file events into a single rebuild
    if (migrationRebuildTimer) clearTimeout(migrationRebuildTimer);
    migrationRebuildTimer = setTimeout(async () => {
      migrationRebuildTimer = null;
      console.log(`[esbuild] migration file changed: ${filename}, rebuilding...`);
      try {
        copyMigrations();
        await buildTsMigrations();
        console.log('[esbuild] migrations rebuilt');
      } catch (err) {
        console.error('[esbuild] migration rebuild failed:', err);
      }
    }, 300);
  });

  console.log('[esbuild] watching for changes...');
} else {
  await Promise.all([
    esbuild.build(mainConfig),
    esbuild.build(preloadConfig),
    esbuild.build(dbProcessConfig),
    esbuild.build(dlaProcessConfig),
    buildTsMigrations(),
  ]);
}
