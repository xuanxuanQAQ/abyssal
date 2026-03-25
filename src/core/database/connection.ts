// ═══ SQLite 连接管理 ═══
// §1.1 初始化序列：打开连接 → PRAGMA → 加载 sqlite-vec → 返回 Database

import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AbyssalConfig } from '../types/config';
import { DatabaseError, ExtensionLoadError } from '../types/errors';
import type { Logger } from '../infra/logger';

// ─── PRAGMA 配置序列 (§1.1 步骤 2) ───

const PRAGMA_SEQUENCE: [string, string | number][] = [
  ['journal_mode', 'WAL'],
  ['foreign_keys', 'ON'],
  ['busy_timeout', 5000],
  ['synchronous', 'NORMAL'],
  ['cache_size', -64000],
  ['temp_store', 'MEMORY'],
  ['mmap_size', 268435456],
];

// ─── sqlite-vec 扩展路径解析 (§1.1 步骤 3) ───

function resolveVecExtensionPath(): string {
  const platform = process.platform;
  const arch = process.arch;

  const extName =
    platform === 'win32'
      ? 'vec0.dll'
      : platform === 'darwin'
        ? 'vec0.dylib'
        : 'vec0.so';

  // 尝试平台-架构子目录
  const candidates = [
    path.join('node_modules', 'sqlite-vec', `${platform}-${arch}`, extName),
    path.join('node_modules', 'sqlite-vec', extName),
    path.join('node_modules', 'sqlite-vec', 'dist', `${platform}-${arch}`, extName),
  ];

  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }

  // 尝试 require.resolve 定位 sqlite-vec 包
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolve = (require as NodeRequire).resolve;
    const pkgDir = path.dirname(resolve('sqlite-vec/package.json'));
    const resolved = path.join(pkgDir, `${platform}-${arch}`, extName);
    if (fs.existsSync(resolved)) return resolved;
    const fallback = path.join(pkgDir, extName);
    if (fs.existsSync(fallback)) return fallback;
  } catch {
    // require.resolve 失败，继续
  }

  throw new Error(
    `sqlite-vec extension not found for ${platform}-${arch}. Searched: ${candidates.join(', ')}`,
  );
}

// ─── 公开接口 ───

export interface OpenDatabaseOptions {
  dbPath: string;
  config: AbyssalConfig;
  logger: Logger;
  /** 跳过 sqlite-vec 加载（用于测试或无向量场景） */
  skipVecExtension?: boolean | undefined;
}

/**
 * 打开 SQLite 连接并执行完整初始化序列。
 * 返回初始化完成的 better-sqlite3 Database 实例。
 */
export function openDatabase(options: OpenDatabaseOptions): Database.Database {
  const { dbPath, config, logger, skipVecExtension } = options;

  // 步骤 1：打开连接
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (err) {
    throw new DatabaseError({
      message: `Failed to open database: ${(err as Error).message}`,
      context: { dbPath },
      cause: err as Error,
    });
  }

  logger.info('Database connection opened', { dbPath });

  // 步骤 2：PRAGMA 序列
  for (const [pragma, value] of PRAGMA_SEQUENCE) {
    try {
      const result = db.pragma(`${pragma} = ${value}`) as unknown;
      // journal_mode 需要校验返回值
      if (pragma === 'journal_mode') {
        const mode =
          Array.isArray(result)
            ? (result[0] as Record<string, unknown>)?.['journal_mode']
            : result;
        if (typeof mode === 'string' && mode.toLowerCase() !== 'wal') {
          logger.warn('WAL mode not enabled, got: ' + String(mode));
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

  // 步骤 3：加载 sqlite-vec 扩展
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
        message: `Failed to load sqlite-vec extension: ${(err as Error).message}`,
        context: {
          dbPath,
          extensionPath: vecPath,
          platform: process.platform,
          arch: process.arch,
        },
        cause: err as Error,
      });
    }

    // 验证扩展加载成功
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
  } else {
    logger.info('sqlite-vec extension loading skipped');
  }

  return db;
}

/**
 * 执行 WAL checkpoint (TRUNCATE 模式)。
 * §1.4: 批量工作流完成后、应用退出前、创建快照时调用。
 */
export function walCheckpoint(db: Database.Database): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
}
