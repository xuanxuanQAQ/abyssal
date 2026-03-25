// ═══ 检索日志 CRUD ═══

import type Database from 'better-sqlite3';
import { now } from '../row-mapper';

export interface SearchLogEntry {
  id: number;
  query: string;
  apiSource: string;
  resultCount: number;
  executedAt: string;
}

export function addSearchLog(
  db: Database.Database,
  query: string,
  apiSource: string,
  resultCount: number,
): number {
  const result = db
    .prepare(
      'INSERT INTO search_log (query, api_source, result_count, executed_at) VALUES (?, ?, ?, ?)',
    )
    .run(query, apiSource, resultCount, now());
  return Number(result.lastInsertRowid);
}

export function getSearchLog(
  db: Database.Database,
  limit: number = 100,
): SearchLogEntry[] {
  const rows = db
    .prepare(
      'SELECT * FROM search_log ORDER BY executed_at DESC LIMIT ?',
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r['id'] as number,
    query: r['query'] as string,
    apiSource: r['api_source'] as string,
    resultCount: r['result_count'] as number,
    executedAt: r['executed_at'] as string,
  }));
}
