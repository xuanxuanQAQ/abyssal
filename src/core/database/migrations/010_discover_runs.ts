/**
 * Migration 010: discover_runs table for search history tracking.
 *
 * Records each discover workflow execution so the library sidebar
 * can display search history groups.
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discover_runs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_dr_created_at ON discover_runs(created_at)`);
}
