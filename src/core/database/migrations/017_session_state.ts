/**
 * Migration 017: Session state persistence.
 *
 * Stores AI working memory and conversation snapshots so they survive restart.
 * - session_memory: WorkingMemory entries with time-decay importance
 * - session_conversation: Serialized orchestrator conversation history
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_memory (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      linked_entities TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      tags TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_conversation (
      key TEXT PRIMARY KEY,
      messages TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_sm_importance ON session_memory(importance DESC)`);
}
