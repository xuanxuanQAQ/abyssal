/**
 * FailureMemory — 失败模式记忆与数据源优先级动态调整
 *
 * 持久化 acquire 过程中每个数据源的失败记录（包括 LLM 检测到的付费墙等），
 * 后续获取时根据 DOI 前缀/出版商的历史失败率动态调整数据源顺序。
 *
 * Feature 2 of LLM-enhanced acquire pipeline.
 *
 * 使用内存缓存 + 异步写入，避免在关键路径上阻塞。
 * getSourceOrdering 使用内存缓存（周期刷新），recordFailure 异步写入。
 */

import type { Logger } from '../infra/logger';

// ─── Types ───

export type AcquireFailureType =
  | 'http_error'
  | 'timeout'
  | 'no_pdf_url'
  | 'validation_failed'
  | 'paywall'
  | 'captcha'
  | 'wrong_paper'
  | 'corrupted'
  | 'unknown';

export interface FailureRecord {
  paperId: string;
  source: string;
  failureType: AcquireFailureType;
  publisher?: string | null;
  doiPrefix?: string | null;
  httpStatus?: number | null;
  detail?: string | null;
}

export interface SourceStats {
  source: string;
  totalAttempts: number;
  failures: number;
  failureRate: number;
}

/**
 * 抽象 DB 接口，由 DbProxy 或 DatabaseService 实现。
 * FailureMemory 不直接依赖 better-sqlite3。
 */
export interface FailureMemoryDb {
  recordAcquireFailure(record: FailureRecord): Promise<void>;
  recordAcquireSuccess(record: { source: string; doiPrefix?: string | null; publisher?: string | null }): Promise<void>;
  getAcquireFailureStats(params: {
    doiPrefix?: string | null;
    publisher?: string | null;
    afterDate: string;
  }): Promise<Array<{ source: string; total: number; failures: number }>>;
}

// ─── Helpers ───

/** 从 DOI 提取出版商前缀，如 "10.1016" (Elsevier) */
export function extractDoiPrefix(doi: string | null): string | null {
  if (!doi) return null;
  const match = doi.match(/^(10\.\d{4,5})\//);
  return match?.[1] ?? null;
}

// ─── FailureMemory ───

export class FailureMemory {
  private readonly logger: Logger;
  private readonly windowDays: number;
  private readonly db: FailureMemoryDb | null;

  // 内存缓存：source → { total, failures } 按 doiPrefix
  private readonly memoryCache = new Map<string, Map<string, { total: number; failures: number }>>();

  constructor(db: FailureMemoryDb | null, logger: Logger, windowDays = 90) {
    this.db = db;
    this.logger = logger;
    this.windowDays = windowDays;
  }

  /**
   * 记录一次失败。异步写入 DB，同时更新内存缓存。
   */
  recordFailure(record: FailureRecord): void {
    // 更新内存缓存
    const cacheKey = record.doiPrefix ?? record.publisher ?? '_default';
    let sourceMap = this.memoryCache.get(cacheKey);
    if (!sourceMap) {
      sourceMap = new Map();
      this.memoryCache.set(cacheKey, sourceMap);
    }
    const entry = sourceMap.get(record.source) ?? { total: 0, failures: 0 };
    entry.total++;
    entry.failures++;
    sourceMap.set(record.source, entry);

    // 异步写入 DB（fire-and-forget）
    if (this.db) {
      this.db.recordAcquireFailure(record).catch((err) => {
        this.logger.warn('[FailureMemory] Async DB write failed', { error: (err as Error).message });
      });
    }
  }

  /**
   * 记录一次成功。增 total 不增 failures，使 failureRate 反映真实成功率。
   * 同时异步写入 DB，避免冷启动后所有源 failureRate ≈ 100% 的偏差。
   */
  recordSuccess(source: string, doi: string | null, publisher: string | null): void {
    const doiPrefix = extractDoiPrefix(doi);
    const cacheKey = doiPrefix ?? publisher ?? '_default';
    let sourceMap = this.memoryCache.get(cacheKey);
    if (!sourceMap) {
      sourceMap = new Map();
      this.memoryCache.set(cacheKey, sourceMap);
    }
    const entry = sourceMap.get(source) ?? { total: 0, failures: 0 };
    entry.total++;
    sourceMap.set(source, entry);

    // 异步写入 DB（fire-and-forget）
    if (this.db) {
      this.db.recordAcquireSuccess({ source, doiPrefix, publisher }).catch((err) => {
        this.logger.warn('[FailureMemory] Async DB success write failed', { error: (err as Error).message });
      });
    }
  }

  /**
   * 根据论文的 DOI 前缀和出版商，返回按预测成功率排序的数据源列表。
   * 使用内存缓存，不阻塞。
   */
  getSourceOrdering(
    defaultSources: string[],
    doi: string | null,
    publisher: string | null,
  ): string[] {
    const doiPrefix = extractDoiPrefix(doi);
    if (!doiPrefix && !publisher) return defaultSources;

    const cacheKey = doiPrefix ?? publisher ?? '_default';
    const sourceMap = this.memoryCache.get(cacheKey);
    if (!sourceMap || sourceMap.size === 0) return defaultSources;

    const failureRates = new Map<string, number>();
    for (const [source, stats] of sourceMap) {
      failureRates.set(source, stats.total > 0 ? stats.failures / stats.total : 0);
    }

    const sorted = [...defaultSources].sort((a, b) => {
      const rateA = failureRates.get(a) ?? 0.5;
      const rateB = failureRates.get(b) ?? 0.5;
      return rateA - rateB;
    });

    if (sorted.some((v, i) => v !== defaultSources[i])) {
      this.logger.info('[FailureMemory] Source ordering adjusted', {
        doiPrefix, publisher, original: defaultSources, adjusted: sorted,
        rates: Object.fromEntries(failureRates),
      });
    }

    return sorted;
  }

  /**
   * 从 DB 加载历史失败数据到内存缓存（启动时调用一次）。
   */
  async loadFromDb(): Promise<void> {
    if (!this.db) return;
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.windowDays);

      // 按 doi_prefix 加载
      const stats = await this.db.getAcquireFailureStats({
        afterDate: cutoff.toISOString(),
      });

      for (const row of stats) {
        // Store under '_default' so getSourceOrdering can find it via fallback key
        const key = (row as Record<string, unknown>)['doiPrefix'] as string
          ?? (row as Record<string, unknown>)['publisher'] as string
          ?? '_default';
        let sourceMap = this.memoryCache.get(key);
        if (!sourceMap) {
          sourceMap = new Map();
          this.memoryCache.set(key, sourceMap);
        }
        // Calibration: if total === failures (legacy data without success records),
        // apply a Bayesian prior — assume at least 50% success rate to avoid
        // cold-start bias where all sources appear ~100% failed.
        const total = row.total > row.failures ? row.total : Math.max(row.failures * 2, row.failures + 1);
        sourceMap.set(row.source, { total, failures: row.failures });
      }

      this.logger.info('[FailureMemory] Loaded from DB', { entries: stats.length });
    } catch (err) {
      this.logger.warn('[FailureMemory] Failed to load from DB', { error: (err as Error).message });
    }
  }
}
