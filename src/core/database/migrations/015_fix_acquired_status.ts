/**
 * 015_fix_acquired_status — Fix invalid 'acquired' fulltextStatus values
 *
 * The acquire workflow previously wrote 'acquired' as fulltextStatus when
 * vector indexing failed, but 'acquired' is not a valid FulltextStatus enum
 * value. This migration corrects those records to 'available' since the
 * PDF and extracted text are present on disk.
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  const result = db
    .prepare(`UPDATE papers SET fulltext_status = 'available' WHERE fulltext_status = 'acquired'`)
    .run();

  if (result.changes > 0) {
    console.log(`[migration 015] Fixed ${result.changes} papers with invalid 'acquired' status → 'available'`);
  }
}
