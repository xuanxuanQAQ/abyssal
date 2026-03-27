// ═══ 检索日志 CRUD ═══
// §7: addSearchLog / getSearchLog

import type Database from 'better-sqlite3';
import { now } from '../row-mapper';

export interface SearchLogEntry {
  id: number;
  query: string;
  apiSource: string;
  params: string | null;
  resultCount: number;
  durationMs: number | null;
  executedAt: string;
}

export function addSearchLog(
  db: Database.Database,
  query: string,
  apiSource: string,
  resultCount: number,
  params?: string | null,
  durationMs?: number | null,
): number {
  const row = db
    .prepare(
      'INSERT INTO search_log (query, api_source, params, result_count, duration_ms, executed_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    )
    .get(query, apiSource, params ?? null, resultCount, durationMs ?? null, now()) as { id: number };
  return row.id;
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
    params: (r['params'] as string) ?? null,
    resultCount: r['result_count'] as number,
    durationMs: (r['duration_ms'] as number) ?? null,
    executedAt: r['executed_at'] as string,
  }));
}
