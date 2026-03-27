// ═══ 事务工具 ═══
// §1.4-1.5: 全部写事务使用 BEGIN IMMEDIATE
// §8.1: SQLITE_BUSY 指数退避重试
// §9.2: 事务耗时/行数追踪日志

import type Database from 'better-sqlite3';
import type { Logger } from '../infra/logger';

// ─── §1.5 IMMEDIATE 写事务 ───

/**
 * 全部写事务的统一入口——使用 BEGIN IMMEDIATE。
 *
 * IMMEDIATE 在事务开始时立即获取 RESERVED 锁：
 * - 如果锁不可用，在 busy_timeout 内重试（而非 DEFERRED 的立即失败）
 * - 一旦获取成功，后续全部写操作不会遇到 SQLITE_BUSY
 * - 避免事务中间才发现锁冲突导致回滚
 */
export function writeTransaction<T>(
  db: Database.Database,
  fn: () => T,
): T {
  return db.transaction(fn).immediate();
}

// ─── §8.1 SQLITE_BUSY 重试 ───

export interface BusyRetryOptions {
  maxRetries?: number;
  /** 初始退避毫秒（后续指数增长） */
  initialDelayMs?: number;
  logger?: Logger;
  /** 操作名称（用于日志） */
  operationName?: string;
}

/**
 * SQLITE_BUSY 捕获 + 指数退避重试。
 *
 * 重试策略（§8.1）：
 * - 单行写入：3 次，固定 1s
 * - 批量写入：3 次，指数 1s→2s→4s
 * - 检查点：3 次，固定 1s（已在 walCheckpoint 内部实现）
 *
 * busy_timeout 是数据库级的最后防线。应用层重试是更粗粒度的恢复——
 * 当整个事务因为 busy_timeout 超时而失败时，等待一段时间后重试整个事务。
 */
export function withBusyRetry<T>(
  fn: () => T,
  options: BusyRetryOptions = {},
): T {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    logger,
    operationName = 'database operation',
  } = options;

  // TODO: busyRetry 触发计数器暴露到 §9.1 并发监控指标

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (!message.includes('SQLITE_BUSY') || attempt >= maxRetries) {
        throw err;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt);
      logger?.warn(`${operationName} hit SQLITE_BUSY, retrying`, {
        attempt: attempt + 1,
        maxRetries,
        delayMs,
      });

      // 同步等待（better-sqlite3 是同步 API，无法 await）
      const deadline = Date.now() + delayMs;
      while (Date.now() < deadline) {
        // busy-wait
      }
    }
  }

  // 不应到达这里（最后一次失败会在 catch 中 throw）
  throw new Error(`${operationName} failed after ${maxRetries} retries`);
}

// ─── §9.2 事务追踪 ───

export interface TracedTransactionOptions {
  /** 操作名称（如 'mergeConcepts'） */
  name: string;
  logger: Logger;
}

/**
 * 带追踪的 IMMEDIATE 写事务。
 *
 * 在 debug 级别记录：操作名、耗时、事务类型。
 * TODO: rowsAffected 按表分组统计——需 DAO 返回结构化结果
 */
export function tracedTransaction<T>(
  db: Database.Database,
  fn: () => T,
  options: TracedTransactionOptions,
): T {
  const { name, logger } = options;
  const startMs = Date.now();

  try {
    const result = writeTransaction(db, fn);
    const durationMs = Date.now() - startMs;

    logger.debug('Transaction completed', {
      operation: name,
      durationMs,
      transactionType: 'IMMEDIATE',
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - startMs;

    logger.error('Transaction failed', err as Error, {
      operation: name,
      durationMs,
      transactionType: 'IMMEDIATE',
    });

    throw err;
  }
}
