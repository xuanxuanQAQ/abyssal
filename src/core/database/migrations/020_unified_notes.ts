/**
 * Migration 020: Unified Notes — move note content from filesystem to DB.
 *
 * - Adds `document_json` column to `research_notes` (ProseMirror JSON storage)
 * - `file_path` kept as nullable for backward compat but no longer used by editor
 */

import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    ALTER TABLE research_notes ADD COLUMN document_json TEXT;
  `);
}
