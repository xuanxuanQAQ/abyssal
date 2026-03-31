// ═══ Migration 012: Writing Pipeline Overhaul ═══
// Adds: outline hierarchy (parent_id/depth), article metadata,
// section draft source tracking + document JSON, article_assets table,
// cross-reference labels table.

import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    -- ── 1. Outline hierarchy persistence ──
    ALTER TABLE outlines ADD COLUMN parent_id TEXT REFERENCES outlines(id) ON DELETE SET NULL;
    ALTER TABLE outlines ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_outlines_parent ON outlines(parent_id);

    -- ── 2. Article metadata ──
    ALTER TABLE articles ADD COLUMN abstract TEXT;
    ALTER TABLE articles ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE articles ADD COLUMN authors TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE articles ADD COLUMN target_word_count INTEGER;

    -- ── 3. Section draft enhancements ──
    ALTER TABLE section_drafts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE section_drafts ADD COLUMN document_json TEXT;

    -- ── 4. Article assets (images, attachments) ──
    CREATE TABLE IF NOT EXISTS article_assets (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      caption TEXT,
      alt_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_article_assets_article ON article_assets(article_id);

    -- ── 5. Cross-reference labels ──
    CREATE TABLE IF NOT EXISTS cross_ref_labels (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      section_id TEXT,
      display_number TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(article_id, label)
    );
    CREATE INDEX IF NOT EXISTS idx_cross_ref_labels_article ON cross_ref_labels(article_id);
  `);
}
