/**
 * 016_layout_blocks — Layout analysis infrastructure
 *
 * Adds tables for DLA (Document Layout Analysis) results persistence
 * and section boundary caching. Extends chunks and concept_mappings
 * with layout-derived metadata.
 *
 * New tables:
 *   - layout_blocks: Per-page DLA ContentBlock results with reading order
 *   - section_boundaries: Persisted section structure (from layout or regex)
 *
 * Column additions:
 *   - chunks.block_type: Source ContentBlockType
 *   - chunks.reading_order: Global reading order position
 *   - chunks.column_layout: 'single' | 'double' | 'mixed'
 *   - concept_mappings.evidence_bbox: JSON NormalizedBBox for block-level evidence
 *   - concept_mappings.evidence_block_type: Block type of evidence source
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

function safeAddColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return row !== undefined;
}

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  // ═══ layout_blocks table ═══
  if (!tableExists(db, 'layout_blocks')) {
    db.exec(`
      CREATE TABLE layout_blocks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id      TEXT NOT NULL,
        page_index    INTEGER NOT NULL,
        block_type    TEXT NOT NULL,
        bbox_x        REAL NOT NULL,
        bbox_y        REAL NOT NULL,
        bbox_w        REAL NOT NULL,
        bbox_h        REAL NOT NULL,
        confidence    REAL NOT NULL,
        reading_order INTEGER NOT NULL DEFAULT 0,
        column_index  INTEGER NOT NULL DEFAULT -1,
        text_content  TEXT,
        char_start    INTEGER,
        char_end      INTEGER,
        model_version TEXT NOT NULL DEFAULT 'unknown',
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE INDEX idx_layout_blocks_paper_page
        ON layout_blocks(paper_id, page_index)
    `);

    db.exec(`
      CREATE INDEX idx_layout_blocks_paper
        ON layout_blocks(paper_id)
    `);
  }

  // ═══ section_boundaries table ═══
  if (!tableExists(db, 'section_boundaries')) {
    db.exec(`
      CREATE TABLE section_boundaries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id    TEXT NOT NULL,
        label       TEXT NOT NULL,
        title       TEXT NOT NULL,
        depth       INTEGER NOT NULL DEFAULT 1,
        char_start  INTEGER NOT NULL,
        char_end    INTEGER NOT NULL,
        page_start  INTEGER NOT NULL,
        page_end    INTEGER NOT NULL,
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
        UNIQUE(paper_id, char_start)
      )
    `);

    db.exec(`
      CREATE INDEX idx_section_boundaries_paper
        ON section_boundaries(paper_id)
    `);
  }

  // ═══ chunks table extensions ═══
  safeAddColumn(db, 'chunks', 'block_type', 'TEXT');
  safeAddColumn(db, 'chunks', 'reading_order', 'INTEGER');
  safeAddColumn(db, 'chunks', 'column_layout', 'TEXT');

  // ═══ concept_mappings table extensions ═══
  if (tableExists(db, 'paper_concept_map')) {
    safeAddColumn(db, 'paper_concept_map', 'evidence_bbox', 'TEXT');
    safeAddColumn(db, 'paper_concept_map', 'evidence_block_type', 'TEXT');
  }

  console.log('[migration 016] Layout analysis infrastructure created');
}
