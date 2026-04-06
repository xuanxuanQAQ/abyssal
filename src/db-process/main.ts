/**
 * DB 子进程入口
 *
 * 由 Electron 主进程通过 child_process.fork() 启动。
 * 使用系统 Node.js 运行——ABI 与 better-sqlite3 编译目标一致，永不冲突。
 *
 * 职责：
 * 1. 接收主进程的 RPC 消息，dispatch 到 DatabaseService 方法
 * 2. 管理 DatabaseService 生命周期（init / switch workspace / close）
 * 3. 序列化返回值发回主进程
 */

import * as path from 'node:path';
import { ConfigLoader } from '../core/infra/config';
import { FileLogger, type Logger } from '../core/infra/logger';
import { loadGlobalConfig } from '../core/infra/global-config';
import { createDatabaseService, type DatabaseService } from '../core/database';
import { getWorkspacePaths, isWorkspace, scaffoldWorkspace } from '../core/workspace';
import type {
  DbProcessMessage, DbResponse, DbLifecycleResponse, DbInitPayload,
} from './protocol';
import { isLifecycleMessage, isDbRequest } from './protocol';

let dbService: DatabaseService | null = null;
let logger: Logger | null = null;
let isShuttingDown = false;

function shutdown(exitCode: number): void {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;

  if (dbService) {
    try { dbService.close(); } catch { /* ignore */ }
    dbService = null;
  }

  process.exit(exitCode);
}

// ─── 初始化 ───

function initDatabase(payload: DbInitPayload): void {
  // 关闭旧连接（workspace 切换时）
  if (dbService) {
    try { dbService.close(); } catch { /* ignore */ }
    dbService = null;
  }

  const { workspaceRoot, userDataPath, skipVecExtension } = payload;

  // 确保工作区已初始化
  if (!isWorkspace(workspaceRoot)) {
    scaffoldWorkspace({ rootDir: workspaceRoot });
  }

  const wsPaths = getWorkspacePaths(workspaceRoot);

  // 加载配置（先于 Logger，以获取 logging.level）
  const globalConfig = loadGlobalConfig(userDataPath);
  const config = ConfigLoader.loadFromWorkspace(workspaceRoot, globalConfig);

  // Logger
  logger = new FileLogger(wsPaths.logs, config.logging.level, true);

  // 数据库初始化
  const dbPath = wsPaths.db;
  const migrationsDir = path.resolve(__dirname, '..', 'core', 'database', 'migrations');

  const fs = require('node:fs') as typeof import('node:fs');
  const dbExists = fs.existsSync(dbPath);
  logger.info('DB subprocess: starting init', { dbPath, dbExists });

  try {
    dbService = createDatabaseService({
      dbPath, config, logger,
      skipVecExtension: skipVecExtension ?? false,
      migrationsDir,
    });
    logger.info('DB subprocess: database initialized', { dbPath });
  } catch (err) {
    const error = err as Error & { code?: string };
    logger.error('DB subprocess: init failed', error, {
      dbPath,
      errorCode: error.code,
      errorName: error.name,
    });

    // Close any partially-opened connection before further action,
    // otherwise the DB file is still locked.
    if (dbService) {
      try { dbService.close(); } catch { /* ignore */ }
      dbService = null;
    }

    // ── Error classification ──
    // Only truly unrecoverable errors (corrupt DB, incompatible file format)
    // should trigger backup-and-recreate. Config/migration errors should
    // propagate so the user can fix their config.
    const errorCode = error.code ?? '';
    const errorMsg = error.message?.toLowerCase() ?? '';
    const isCorruptDb =
      errorMsg.includes('not a database') ||
      errorMsg.includes('file is not a database') ||
      errorMsg.includes('disk image is malformed') ||
      errorMsg.includes('database disk image is malformed') ||
      errorCode === 'SQLITE_CORRUPT' ||
      errorCode === 'SQLITE_NOTADB';

    if (!isCorruptDb) {
      // Migration errors, extension load errors, config mismatches, etc.
      // — do NOT delete the database. Re-throw so caller reports the error.
      logger.warn('DB subprocess: init error is non-corrupt — preserving database', {
        errorCode,
        errorName: error.name,
      });
      throw err;
    }

    // ── Corrupt DB: back up and recreate ──
    logger.warn('DB subprocess: database appears corrupt — backing up and recreating');

    if (fs.existsSync(dbPath)) {
      const backupName = `${dbPath}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(dbPath, backupName);
        for (const suffix of ['-wal', '-shm']) {
          const f = dbPath + suffix;
          if (fs.existsSync(f)) fs.copyFileSync(f, backupName + suffix);
        }
        logger.warn('DB subprocess: corrupt database backed up', { backupPath: backupName });
      } catch (backupErr) {
        logger.error('DB subprocess: backup also failed', backupErr as Error);
      }

      // Remove original files so a fresh DB can be created
      for (const suffix of ['', '-wal', '-shm']) {
        const f = dbPath + suffix;
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
      }
    }

    // Retry with a fresh database
    dbService = createDatabaseService({
      dbPath, config, logger,
      skipVecExtension: skipVecExtension ?? false,
      migrationsDir,
    });
    logger.warn('DB subprocess: initialized with fresh database (corrupt data backed up)', { dbPath });
  }
}

// ─── RPC Dispatch ───

/**
 * 将 RPC 方法名映射到 DatabaseService 方法调用。
 *
 * 所有 DatabaseService 的公共方法都通过反射调用：
 *   method = 'addPaper' → dbService.addPaper(...args)
 *
 * Float32Array 参数在传输中被 JSON 转为普通数组，
 * 需要在此处还原为 Float32Array。
 */
function dispatch(method: string, args: unknown[]): unknown {
  if (!dbService) {
    throw Object.assign(new Error('Database not initialized'), { code: 'DB_NOT_READY' });
  }

  // 安全检查：只允许调用 DatabaseService 的公共方法
  // 排除内部方法和属性访问
  const BLOCKED = new Set([
    'constructor', 'raw', 'statements', 'close',
    'setPauseWorkerWrites', 'dbWriteMutex',
  ]);

  if (BLOCKED.has(method)) {
    throw Object.assign(
      new Error(`Method "${method}" is not allowed via RPC`),
      { code: 'METHOD_NOT_ALLOWED' },
    );
  }

  const fn = (dbService as unknown as Record<string, unknown>)[method];
  if (typeof fn !== 'function') {
    throw Object.assign(
      new Error(`Unknown method: ${method}`),
      { code: 'METHOD_NOT_FOUND' },
    );
  }

  // Float32Array 还原：IPC 传输中 Float32Array 变为普通对象
  // 检查参数中是否有需要还原的 embedding 数据
  const restoredArgs = args.map(restoreTypedArrays);

  return fn.call(dbService, ...restoredArgs);
}

/**
 * 递归还原 JSON 序列化中丢失的 Float32Array。
 *
 * 约定：发送方将 Float32Array 编码为 { __type: 'Float32Array', data: number[] }
 */
function restoreTypedArrays(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // 编码标记
    if (obj['__type'] === 'Float32Array' && Array.isArray(obj['data'])) {
      return new Float32Array(obj['data'] as number[]);
    }

    // 递归处理数组
    if (Array.isArray(value)) {
      return value.map(restoreTypedArrays);
    }

    // 递归处理对象（浅层即可，不需要深度递归普通对象）
    // 只处理包含 __type 标记的情况
  }

  return value;
}

/**
 * 序列化返回值，将 Float32Array 编码为可 JSON 传输的格式。
 */
function serializeResult(value: unknown): unknown {
  if (value instanceof Float32Array) {
    return { __type: 'Float32Array', data: Array.from(value) };
  }
  if (value instanceof Set) {
    return { __type: 'Set', data: Array.from(value) };
  }
  if (value instanceof Map) {
    return { __type: 'Map', data: Array.from(value.entries()) };
  }
  // Promise: 等待解析
  if (value instanceof Promise) {
    return value.then(serializeResult);
  }
  return value;
}

// ─── 消息处理 ───

process.on('message', async (msg: DbProcessMessage) => {
  if (isLifecycleMessage(msg)) {
    const response: DbLifecycleResponse = {
      type: 'lifecycle',
      action: msg.action,
      success: true,
    };

    try {
      switch (msg.action) {
        case 'init':
        case 'switch':
          if (!msg.payload) throw new Error('Missing payload for init/switch');
          initDatabase(msg.payload);
          break;
        case 'close':
          if (dbService) {
            dbService.close();
            dbService = null;
          }
          break;
      }
    } catch (err) {
      response.success = false;
      response.error = (err as Error).message;
    }

    process.send!(response);

    // close 后退出进程
    if (msg.action === 'close') {
      process.exit(0);
    }
    return;
  }

  if (isDbRequest(msg)) {
    const response: DbResponse = { id: msg.id };

    try {
      let result = dispatch(msg.method, msg.args);
      // 处理 async 方法（如 createSnapshot）
      if (result instanceof Promise) {
        result = await result;
      }
      response.result = serializeResult(result);
    } catch (err) {
      const error = err as Error & { code?: string; context?: Record<string, unknown> };
      response.error = {
        message: error.message,
        code: error.code ?? 'UNKNOWN',
        name: error.name ?? 'Error',
        ...(error.context ? { context: error.context } : {}),
      };
    }

    process.send!(response);
  }
});

// ─── 优雅退出 ───

process.on('disconnect', () => {
  logger?.info('DB subprocess: parent disconnected, shutting down');
  shutdown(0);
});

process.on('SIGTERM', () => {
  shutdown(0);
});

process.on('SIGINT', () => {
  shutdown(0);
});

process.on('uncaughtException', (err) => {
  logger?.error('DB subprocess uncaught exception', err);
  shutdown(1);
});

// 通知父进程子进程已准备就绪
process.send!({ type: 'lifecycle', action: 'ready', success: true });
