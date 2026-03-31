// ═══ ReconCache — Recon 结果持久化缓存 ═══
// 使用 SQLite recon_cache 表存储侦察结果，避免重复 API 查询。
// 双 TTL 策略：稳定数据（出版商域名）长缓存，OA 状态短缓存。

import type { Logger } from '../infra/logger';

// ─── Types ───

export interface CachedRecon {
  doi: string;
  publisherDomain: string | null;
  resolvedUrl: string | null;
  oaStatus: string | null;
  pdfUrls: string[];
  repositoryUrls: string[];
  landingPageUrls: string[];
  crossrefPdfLinks: string[];
  licenseUrl: string | null;
  reconAt: string;
}

/** 抽象 DB 接口，由 DbProxy 或 DatabaseService 实现 */
export interface ReconCacheDb {
  getRecon(doi: string): Promise<CachedRecon | null>;
  upsertRecon(recon: CachedRecon): Promise<void>;
}

// ─── ReconCache ───

export class ReconCache {
  constructor(
    private readonly db: ReconCacheDb | null,
    private readonly logger: Logger,
  ) {}

  /**
   * 查询缓存。根据数据类型使用不同的 TTL：
   * - 稳定数据（publisherDomain, resolvedUrl, repositoryUrls）：使用 stableTtlDays
   * - OA 数据（oaStatus, pdfUrls）：使用 oaRefreshDays
   *
   * 如果稳定数据未过期但 OA 数据已过期，返回缓存但标记 oaExpired=true。
   */
  async get(doi: string, stableTtlDays: number, oaRefreshDays: number): Promise<{
    cached: CachedRecon | null;
    oaExpired: boolean;
  }> {
    if (!this.db) return { cached: null, oaExpired: false };

    try {
      const row = await this.db.getRecon(doi);
      if (!row) return { cached: null, oaExpired: false };

      const reconDate = new Date(row.reconAt);
      const now = new Date();
      const ageDays = (now.getTime() - reconDate.getTime()) / (1000 * 60 * 60 * 24);

      // 稳定数据过期 → 完全无效
      if (ageDays > stableTtlDays) {
        return { cached: null, oaExpired: false };
      }

      // OA 数据过期 → 缓存可用但需刷新 OA 部分
      const oaExpired = ageDays > oaRefreshDays;

      this.logger.debug('[ReconCache] Cache hit', {
        doi,
        ageDays: Math.round(ageDays),
        oaExpired,
      });

      return { cached: row, oaExpired };
    } catch (err) {
      this.logger.warn('[ReconCache] Cache read error', { error: (err as Error).message });
      return { cached: null, oaExpired: false };
    }
  }

  /** 写入/更新缓存 */
  async set(recon: CachedRecon): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.upsertRecon(recon);
    } catch (err) {
      this.logger.warn('[ReconCache] Cache write error', { error: (err as Error).message });
    }
  }
}
