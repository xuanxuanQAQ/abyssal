/**
 * Session State DAO — persistence for WorkingMemory and conversation history.
 *
 * Enables AI context to survive app restarts.
 */

import type Database from 'better-sqlite3';
import { writeTransaction } from '../transaction-utils';

// ─── Working Memory ───

export interface MemoryRow {
  id: string;
  type: string;
  content: string;
  source: string;
  linked_entities: string; // JSON array
  importance: number;
  created_at: number;
  last_accessed_at: number;
  tags: string | null; // JSON array or null
}

export function saveMemoryEntries(db: Database.Database, entries: MemoryRow[]): void {
  writeTransaction(db, () => {
    db.prepare('DELETE FROM session_memory').run();
    const stmt = db.prepare(`
      INSERT INTO session_memory (id, type, content, source, linked_entities, importance, created_at, last_accessed_at, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of entries) {
      stmt.run(e.id, e.type, e.content, e.source, e.linked_entities, e.importance, e.created_at, e.last_accessed_at, e.tags);
    }
  });
}

export function loadMemoryEntries(db: Database.Database): MemoryRow[] {
  return db.prepare('SELECT * FROM session_memory ORDER BY importance DESC').all() as MemoryRow[];
}

export function clearMemoryEntries(db: Database.Database): void {
  db.prepare('DELETE FROM session_memory').run();
}

// ─── Conversation ───

export function saveConversation(db: Database.Database, key: string, messagesJson: string): void {
  db.prepare(`
    INSERT INTO session_conversation (key, messages, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET messages = excluded.messages, updated_at = datetime('now')
  `).run(key, messagesJson);
}

export function loadConversation(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT messages FROM session_conversation WHERE key = ?').get(key) as { messages: string } | undefined;
  return row?.messages ?? null;
}

export function clearConversation(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM session_conversation WHERE key = ?').run(key);
}
