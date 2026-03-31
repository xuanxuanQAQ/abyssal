// ═══ Migration 011: References + Hydrate Log Tables ═══
// 存储从论文中提取的参考文献条目 + 水合审计日志

import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS extracted_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      doi TEXT,
      year INTEGER,
      rough_authors TEXT,
      rough_title TEXT,
      resolved_paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_extracted_references_paper
      ON extracted_references(paper_id);
    CREATE INDEX IF NOT EXISTS idx_extracted_references_doi
      ON extracted_references(doi) WHERE doi IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_extracted_references_resolved
      ON extracted_references(resolved_paper_id) WHERE resolved_paper_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS hydrate_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      field_value TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hydrate_log_paper
      ON hydrate_log(paper_id);
  `);
}
