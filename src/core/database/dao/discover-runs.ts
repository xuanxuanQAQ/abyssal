// ═══ discover_runs CRUD ═══

import type Database from 'better-sqlite3';
import type { DiscoverRun } from '../../../shared-types/models';

// ─── listDiscoverRuns ───

export function listDiscoverRuns(db: Database.Database): DiscoverRun[] {
  const rows = db
    .prepare('SELECT id, query, result_count, created_at FROM discover_runs ORDER BY created_at DESC LIMIT 50')
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    runId: row['id'] as string,
    query: row['query'] as string,
    resultCount: row['result_count'] as number,
    timestamp: row['created_at'] as string,
  }));
}

// ─── addDiscoverRun ───

export function addDiscoverRun(
  db: Database.Database,
  run: { id: string; query: string; resultCount: number },
): void {
  db.prepare(
    'INSERT INTO discover_runs (id, query, result_count) VALUES (?, ?, ?)',
  ).run(run.id, run.query, run.resultCount);
}
