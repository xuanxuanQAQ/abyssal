// ═══ Migration 018: OCR Lines table ═══
//
// Stores Tesseract OCR line-level bounding boxes for scanned pages.
// Used by the reader's OcrTextLayer to render properly aligned
// transparent text over the canvas rendering.

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ocr_lines (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id    TEXT    NOT NULL,
      page_index  INTEGER NOT NULL,
      line_index  INTEGER NOT NULL,
      text        TEXT    NOT NULL,
      bbox_x      REAL    NOT NULL,
      bbox_y      REAL    NOT NULL,
      bbox_w      REAL    NOT NULL,
      bbox_h      REAL    NOT NULL,
      confidence  REAL    NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ocr_lines_paper_page
      ON ocr_lines (paper_id, page_index);

    CREATE INDEX IF NOT EXISTS idx_ocr_lines_paper
      ON ocr_lines (paper_id);
  `);
}
