// ═══ SQLite 连接管理 ═══
// §1.1-1.4: 打开连接 → PRAGMA 序列 → sqlite-vec 加载与验证
// §2.3: WAL checkpoint 重试逻辑

import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AbyssalConfig } from '../types/config';
import { DatabaseError, ExtensionLoadError } from '../types/errors';
import type { Logger } from '../infra/logger';

// ─── PRAGMA 配置序列 (§1.3 步骤 2，七条，严格顺序) ───

const PRAGMA_SEQUENCE: [string, string | number][] = [
  ['journal_mode', 'WAL'],       // 1. 必须第一个——需要 EXCLUSIVE lock
  ['foreign_keys', 'ON'],        // 2. 非持久化，每次连接必须设置
  ['busy_timeout', 5000],        // 3. 锁等待 5s
  ['synchronous', 'NORMAL'],     // 4. WAL 模式最佳平衡
  ['cache_size', -64000],        // 5. 64 MB 页面缓存
  ['temp_store', 'MEMORY'],      // 6. 临时表/排序使用内存
  ['mmap_size', 268435456],      // 7. 256 MB 内存映射
];

// macOS 上 fsync 不保证物理写入磁盘硬件（仅清空内核缓冲区），
// 只有 fcntl(F_FULLFSYNC) 才能保证。SQLite 通过此 PRAGMA 控制。
const MACOS_EXTRA_PRAGMAS: [string, string | number][] = [
  ['fullfsync', 'ON'],
];

// ─── §1.4 sqlite-vec 扩展路径解析 ───

function resolveVecExtensionPath(): string {
  // Native DLL 不能从 asar 归档内加载，必须指向 app.asar.unpacked
  const fixAsarPath = (p: string) => p.replace(/app\.asar(?![.]unpacked)/, 'app.asar.unpacked');

  // 优先级 1：环境变量覆盖
  const envPath = process.env['ABYSSAL_SQLITE_VEC_PATH'];
  if (envPath) {
    if (fs.existsSync(envPath)) return path.resolve(envPath);
    throw new Error(
      `ABYSSAL_SQLITE_VEC_PATH set to "${envPath}" but file does not exist`,
    );
  }

  // 优先级 2：使用 sqlite-vec npm 包的官方路径解析
  try {
    const { getLoadablePath } = require('sqlite-vec') as { getLoadablePath: () => string };
    const loadablePath = fixAsarPath(getLoadablePath());
    if (fs.existsSync(loadablePath)) return loadablePath;
  } catch {
    // sqlite-vec npm 包未安装，继续手动搜索
  }

  // 优先级 3：手动搜索已知路径
  const platform = process.platform;
  const arch = process.arch;

  const extName =
    platform === 'win32'
      ? 'vec0.dll'
      : platform === 'darwin'
        ? 'vec0.dylib'
        : 'vec0.so';

  const os = platform === 'win32' ? 'windows' : platform;

  const searchBases: string[] = [];

  // 通过 require.resolve 定位 node_modules（兼容 asar）
  try {
    const resolvedDir = path.dirname(require.resolve('sqlite-vec/package.json'));
    searchBases.push(path.resolve(resolvedDir, '..'));
    const unpackedDir = fixAsarPath(resolvedDir);
    if (unpackedDir !== resolvedDir) {
      searchBases.push(path.resolve(unpackedDir, '..'));
    }
  } catch { /* ignore */ }

  // 开发环境
  searchBases.push(path.resolve('node_modules'));
  searchBases.push(path.resolve(__dirname, '..', '..', '..', 'node_modules'));

  const candidates: string[] = [];
  for (const base of searchBases) {
    candidates.push(
      path.join(base, `sqlite-vec-${os}-${arch}`, extName),
      path.join(base, 'sqlite-vec', `${platform}-${arch}`, extName),
      path.join(base, 'sqlite-vec', extName),
    );
  }

  for (const candidate of candidates) {
    const fixed = fixAsarPath(candidate);
    if (fs.existsSync(fixed)) {
      return fixed;
    }
  }

  throw new Error(
    `sqlite-vec extension not found for ${platform}-${arch}. Searched: ${candidates.join(', ')}`,
  );
}

// ─── §1.2 异常分类 ───

function classifyOpenError(err: Error, dbPath: string): DatabaseError {
  const msg = err.message.toLowerCase();
  let reason = 'unknown';

  if (msg.includes('no such file') || msg.includes('cannot open') || msg.includes('enoent')) {
    reason = 'directory_not_found';
  } else if (msg.includes('not a database') || msg.includes('file is not a database')) {
    reason = 'not_a_database';
  } else if (msg.includes('busy') || msg.includes('locked') || msg.includes('sqlite_busy')) {
    reason = 'locked_by_other_process';
  } else if (msg.includes('permission') || msg.includes('eacces') || msg.includes('eperm')) {
    reason = 'permission_denied';
  }

  return new DatabaseError({
    message: `Failed to open database: ${err.message}`,
    context: { dbPath, reason },
    cause: err,
  });
}

// ─── 公开接口 ───

export interface OpenDatabaseOptions {
  dbPath: string;
  config: AbyssalConfig;
  logger: Logger;
  /** 只读模式，默认 false */
  readOnly?: boolean | undefined;
  /** 跳过 sqlite-vec 加载（用于测试或无向量场景） */
  skipVecExtension?: boolean | undefined;
}

/**
 * 打开 SQLite 连接并执行完整初始化序列 (§1.1)。
 *
 * 序列：打开连接 → PRAGMA × 7 → 加载 sqlite-vec → 验证扩展
 */
export function openDatabase(options: OpenDatabaseOptions): Database.Database {
  const { dbPath, logger, readOnly = false, skipVecExtension } = options;

  // ── 步骤 1：打开连接 ──
  let db: Database.Database;
  try {
    db = new Database(dbPath, {
      readonly: readOnly,
      fileMustExist: false,
      timeout: 5000,
    });
  } catch (err) {
    throw classifyOpenError(err as Error, dbPath);
  }

  logger.info('Database connection opened', { dbPath, readOnly });

  // ── Fix #2b: 设置 SQLITE_TMPDIR 到 workspace 所在目录 ──
  // Electron 沙箱或 macOS 严格权限环境下，默认系统临时目录可能不可写，
  // 导致 VACUUM 等需要临时文件的操作抛出 SQLITE_CANTOPEN。
  // PRAGMA temp_store_directory 已弃用，但环境变量 SQLITE_TMPDIR 仍然生效。
  if (!process.env['SQLITE_TMPDIR']) {
    const dbDir = path.dirname(dbPath);
    process.env['SQLITE_TMPDIR'] = dbDir;
  }

  // ── 步骤 2：PRAGMA 序列（七条，严格顺序） ──
  // 合并平台特定 PRAGMA（macOS fullfsync）
  const pragmas: [string, string | number][] = [
    ...PRAGMA_SEQUENCE,
    ...(process.platform === 'darwin' ? MACOS_EXTRA_PRAGMAS : []),
  ];

  for (const [pragma, value] of pragmas) {
    // 只读模式跳过 journal_mode——无法写入文件头
    if (readOnly && pragma === 'journal_mode') continue;

    try {
      const result = db.pragma(`${pragma} = ${value}`) as unknown;

      // journal_mode 返回值验证
      if (pragma === 'journal_mode') {
        const mode =
          Array.isArray(result)
            ? (result[0] as Record<string, unknown>)?.['journal_mode']
            : result;
        if (typeof mode === 'string' && mode.toLowerCase() !== 'wal') {
          logger.warn('WAL mode not enabled, got: ' + String(mode));
        }
      }

      // foreign_keys 返回值验证
      if (pragma === 'foreign_keys') {
        const fkResult = db.pragma('foreign_keys') as [{ foreign_keys: number }] | [];
        if (fkResult.length === 0 || fkResult[0]!.foreign_keys !== 1) {
          logger.warn('foreign_keys could not be enabled');
        }
      }
    } catch (err) {
      throw new DatabaseError({
        message: `Failed to set PRAGMA ${pragma}: ${(err as Error).message}`,
        context: { dbPath, pragma, value: String(value) },
        cause: err as Error,
      });
    }
  }

  logger.debug('PRAGMA sequence completed');

  // ── 步骤 3-4：sqlite-vec 扩展加载与验证 ──
  if (!skipVecExtension) {
    let vecPath: string;
    try {
      vecPath = resolveVecExtensionPath();
    } catch (err) {
      throw new ExtensionLoadError({
        message: `sqlite-vec extension path resolution failed: ${(err as Error).message}`,
        context: {
          dbPath,
          platform: process.platform,
          arch: process.arch,
        },
        cause: err as Error,
      });
    }

    try {
      db.loadExtension(vecPath);
    } catch (err) {
      throw new ExtensionLoadError({
        message: `Failed to load sqlite-vec extension: ${(err as Error).message} [path=${vecPath}]`,
        context: {
          dbPath,
          extensionPath: vecPath,
          platform: process.platform,
          arch: process.arch,
        },
        cause: err as Error,
      });
    }

    // 验证 vec_version()
    try {
      const versionRow = db.prepare('SELECT vec_version() AS v').get() as
        | { v: string }
        | undefined;
      logger.info('sqlite-vec extension loaded', {
        version: versionRow?.v ?? 'unknown',
      });
    } catch (err) {
      throw new ExtensionLoadError({
        message: `sqlite-vec loaded but vec_version() failed: ${(err as Error).message}`,
        context: { dbPath, extensionPath: vecPath },
        cause: err as Error,
      });
    }

    // §1.4 额外验证：临时 vec0 虚拟表创建+销毁
    try {
      db.exec('CREATE VIRTUAL TABLE _vec_test USING vec0(v float[4])');
      db.exec('DROP TABLE _vec_test');
    } catch (err) {
      throw new ExtensionLoadError({
        message: `sqlite-vec vec0 virtual table test failed: ${(err as Error).message}`,
        context: { dbPath, extensionPath: vecPath },
        cause: err as Error,
      });
    }
  } else {
    logger.info('sqlite-vec extension loading skipped');
  }

  return db;
}

// ─── §2.3 WAL checkpoint（含重试逻辑 + Worker 协调） ───

import { syncSleep } from './transaction-utils';

export interface CheckpointResult {
  busy: number;
  log: number;
  checkpointed: number;
}

export interface WalCheckpointOptions {
  logger?: Logger;
  /**
   * Fix #1: 在执行 TRUNCATE checkpoint 之前调用的回调。
   *
   * 主线程同步执行 wal_checkpoint(TRUNCATE) 需要 EXCLUSIVE lock。
   * 如果 Worker Thread 正在执行长写事务，主线程会被 busy_timeout 阻塞，
   * 导致 UI 冻结。
   *
   * 此回调应通知 Worker 暂停写入队列并等待当前事务提交。
   * 返回一个 release 函数——checkpoint 完成后调用以恢复 Worker 写入。
   *
   * 如果未提供此回调，直接执行 checkpoint（兼容无 Worker 场景）。
   */
  pauseWorkerWrites?: (() => (() => void)) | undefined;
}

/**
 * 执行 WAL checkpoint。
 *
 * 策略 (§2.3):
 * 1. 调用 pauseWorkerWrites 暂停 Worker 写入（如果提供）
 * 2. 尝试 TRUNCATE（合并全部 WAL + 截断文件）
 * 3. busy > 0 时等待 1s 重试，最多 3 次
 * 4. 仍然 busy 则回退 PASSIVE（不阻塞，不完全合并）
 * 5. 调用 release 恢复 Worker 写入
 */
export function walCheckpoint(
  db: Database.Database,
  options?: WalCheckpointOptions,
): CheckpointResult {
  const { logger, pauseWorkerWrites } = options ?? {};
  const maxRetries = 3;
  const retryDelayMs = 1000;

  // Fix #1: 暂停 Worker 写入，防止 TRUNCATE checkpoint 与长写事务死锁
  let resumeWorker: (() => void) | undefined;
  try {
    resumeWorker = pauseWorkerWrites?.();
  } catch (err) {
    logger?.warn('Failed to pause worker writes before checkpoint', {
      error: (err as Error).message,
    });
  }

  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const rows = db.pragma('wal_checkpoint(TRUNCATE)') as
        Array<{ busy: number; log: number; checkpointed: number }>;
      const result = rows[0];
      if (!result || result.busy === 0) {
        return result ?? { busy: 0, log: 0, checkpointed: 0 };
      }

      logger?.warn('WAL TRUNCATE checkpoint blocked by active readers, retrying', {
        attempt: attempt + 1,
        busy: result.busy,
      });

      syncSleep(retryDelayMs);
    }

    // 回退到 PASSIVE——不阻塞，不完全合并
    logger?.warn('WAL TRUNCATE failed after retries, falling back to PASSIVE');
    const passiveRows = db.pragma('wal_checkpoint(PASSIVE)') as
      Array<{ busy: number; log: number; checkpointed: number }>;
    return passiveRows[0] ?? { busy: 0, log: 0, checkpointed: 0 };
  } finally {
    // checkpoint 完成（或失败），恢复 Worker 写入
    resumeWorker?.();
  }
}
