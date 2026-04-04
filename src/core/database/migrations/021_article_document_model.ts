import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    ALTER TABLE articles ADD COLUMN document_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}' ;

    CREATE TABLE IF NOT EXISTS article_section_meta (
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      writing_instruction TEXT,
      concept_ids TEXT NOT NULL DEFAULT '[]',
      paper_ids TEXT NOT NULL DEFAULT '[]',
      ai_model TEXT,
      evidence_status TEXT,
      evidence_gaps TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (article_id, section_id)
    );
    CREATE INDEX IF NOT EXISTS idx_article_section_meta_article ON article_section_meta(article_id);

    CREATE TABLE IF NOT EXISTS article_section_versions (
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      document_json TEXT,
      content_hash TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (article_id, section_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_article_section_versions_lookup ON article_section_versions(article_id, section_id, version DESC);
  `);
}