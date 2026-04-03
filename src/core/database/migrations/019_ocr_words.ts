// ═══ Migration 019: Add words_json to ocr_lines ═══
//
// Stores word-level bounding boxes as JSON for precise text alignment.

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  // Check if column already exists (idempotent)
  const cols = db.pragma('table_info(ocr_lines)') as Array<{ name: string }>;
  if (cols.some((c) => c.name === 'words_json')) return;

  db.exec(`ALTER TABLE ocr_lines ADD COLUMN words_json TEXT`);
}
