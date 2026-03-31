// ═══ Migration 013: Chat Message Persistence ═══
// Adds: chat_sessions and chat_messages tables for persisting
// AI chat history across app restarts.

import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    -- ── 1. Chat sessions ──
    CREATE TABLE IF NOT EXISTS chat_sessions (
      context_source_key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── 2. Chat messages ──
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      context_source_key TEXT NOT NULL REFERENCES chat_sessions(context_source_key) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      tool_calls TEXT,
      citations TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_ts
      ON chat_messages(context_source_key, timestamp DESC);
  `);
}
