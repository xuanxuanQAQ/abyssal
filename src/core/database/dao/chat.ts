// ═══ 聊天消息持久化 ═══
// saveMessage / getHistory / deleteSession / listSessions

import type Database from 'better-sqlite3';
import type { ChatMessageRecord, ChatSessionSummary, PaginationOpts } from '../../../shared-types/models';
import { writeTransaction } from '../transaction-utils';

// ─── saveMessage ───

export function saveMessage(db: Database.Database, record: ChatMessageRecord): void {
  writeTransaction(db, () => {
    // Upsert session row (update last_message_at if exists)
    db.prepare(`
      INSERT INTO chat_sessions (context_source_key, last_message_at)
      VALUES (?, datetime('now'))
      ON CONFLICT(context_source_key) DO UPDATE SET last_message_at = datetime('now')
    `).run(record.contextSourceKey);

    // Insert message (ignore duplicates from retry / double-send)
    db.prepare(`
      INSERT OR IGNORE INTO chat_messages (id, context_source_key, role, content, timestamp, tool_calls, citations)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.contextSourceKey,
      record.role,
      record.content,
      record.timestamp,
      record.toolCalls ?? null,
      record.citations ?? null,
    );
  });
}

// ─── getHistory ───

export function getHistory(
  db: Database.Database,
  contextKey: string,
  opts?: PaginationOpts,
): ChatMessageRecord[] {
  const limit = opts?.limit ?? 50;
  const beforeTimestamp = opts?.beforeTimestamp;

  if (beforeTimestamp != null) {
    return db.prepare(`
      SELECT id, context_source_key AS contextSourceKey, role, content, timestamp, tool_calls AS toolCalls, citations
      FROM chat_messages
      WHERE context_source_key = ? AND timestamp < ?
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ?
    `).all(contextKey, beforeTimestamp, limit) as ChatMessageRecord[];
  }

  return db.prepare(`
    SELECT id, context_source_key AS contextSourceKey, role, content, timestamp, tool_calls AS toolCalls, citations
    FROM chat_messages
    WHERE context_source_key = ?
    ORDER BY timestamp DESC, rowid DESC
    LIMIT ?
  `).all(contextKey, limit) as ChatMessageRecord[];
}

// ─── deleteSession ───

export function deleteSession(db: Database.Database, contextKey: string): void {
  writeTransaction(db, () => {
    // CASCADE deletes chat_messages automatically
    db.prepare('DELETE FROM chat_sessions WHERE context_source_key = ?').run(contextKey);
  });
}

// ─── listSessions ───

export function listSessions(db: Database.Database): ChatSessionSummary[] {
  return db.prepare(`
    SELECT
      s.context_source_key AS contextSourceKey,
      COUNT(m.id) AS messageCount,
      COALESCE(MAX(m.timestamp), 0) AS lastMessageAt
    FROM chat_sessions s
    LEFT JOIN chat_messages m ON m.context_source_key = s.context_source_key
    GROUP BY s.context_source_key
    ORDER BY lastMessageAt DESC
  `).all() as ChatSessionSummary[];
}
