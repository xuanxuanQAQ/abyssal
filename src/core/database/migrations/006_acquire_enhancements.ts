/**
 * 006_acquire_enhancements — acquire 管线增强
 *
 * 1. papers 表新增 failure_count, fulltext_source 列
 * 2. 新建 acquire_failure_log 表用于失败模式记忆
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  // ── papers 表: 添加缺失列 ──

  const paperCols = db.prepare(`PRAGMA table_info(papers)`).all() as Array<{ name: string }>;
  const colNames = new Set(paperCols.map((c) => c.name));

  if (!colNames.has('failure_count')) {
    db.exec(`ALTER TABLE papers ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!colNames.has('fulltext_source')) {
    db.exec(`ALTER TABLE papers ADD COLUMN fulltext_source TEXT`);
  }
  if (!colNames.has('text_path')) {
    db.exec(`ALTER TABLE papers ADD COLUMN text_path TEXT`);
  }
  if (!colNames.has('identifiers_resolved_via')) {
    db.exec(`ALTER TABLE papers ADD COLUMN identifiers_resolved_via TEXT`);
  }

  // ── acquire_failure_log 表 ──

  db.exec(`
    CREATE TABLE IF NOT EXISTS acquire_failure_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id      TEXT NOT NULL,
      source        TEXT NOT NULL,
      failure_type  TEXT NOT NULL,
      publisher     TEXT,
      doi_prefix    TEXT,
      http_status   INTEGER,
      detail        TEXT,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_afl_source
      ON acquire_failure_log(source);
    CREATE INDEX IF NOT EXISTS idx_afl_doi_prefix
      ON acquire_failure_log(doi_prefix) WHERE doi_prefix IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_afl_failure_type
      ON acquire_failure_log(failure_type);
    CREATE INDEX IF NOT EXISTS idx_afl_created_at
      ON acquire_failure_log(created_at);
  `);
}
