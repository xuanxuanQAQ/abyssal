/**
 * 014_recon_cache — Acquire Pipeline v2: Recon 结果持久化缓存
 *
 * 独立 recon_cache 表（DOI 主键）：存储 DOI HEAD 重定向、OpenAlex、CrossRef 侦察结果。
 * 与 papers 表分离，因为：
 *   1. 一个 DOI 可能尚无 paper 记录（预发现阶段）
 *   2. 多条 paper 可共享同一 DOI 的 recon 数据
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recon_cache (
      doi               TEXT PRIMARY KEY,
      publisher_domain  TEXT,
      resolved_url      TEXT,
      oa_status         TEXT,
      pdf_urls          TEXT NOT NULL DEFAULT '[]',
      repository_urls   TEXT NOT NULL DEFAULT '[]',
      landing_page_urls TEXT NOT NULL DEFAULT '[]',
      crossref_pdf_links TEXT NOT NULL DEFAULT '[]',
      license_url       TEXT,
      recon_at          TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_recon_cache_recon_at
      ON recon_cache(recon_at);
  `);
}
