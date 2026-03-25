// ═══ 引用关系 CRUD ═══

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';

export function addCitation(
  db: Database.Database,
  citingId: PaperId,
  citedId: PaperId,
): void {
  db.prepare(
    'INSERT OR IGNORE INTO citations (citing_id, cited_id) VALUES (?, ?)',
  ).run(citingId, citedId);
}

export function addCitations(
  db: Database.Database,
  pairs: Array<{ citingId: PaperId; citedId: PaperId }>,
): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO citations (citing_id, cited_id) VALUES (?, ?)',
  );
  const batchInsert = db.transaction((items: typeof pairs) => {
    for (const { citingId, citedId } of items) {
      insert.run(citingId, citedId);
    }
  });
  batchInsert(pairs);
}

export function getCitationsFrom(
  db: Database.Database,
  citingId: PaperId,
): PaperId[] {
  const rows = db
    .prepare('SELECT cited_id FROM citations WHERE citing_id = ?')
    .all(citingId) as { cited_id: string }[];
  return rows.map((r) => r.cited_id as PaperId);
}

export function getCitationsTo(
  db: Database.Database,
  citedId: PaperId,
): PaperId[] {
  const rows = db
    .prepare('SELECT citing_id FROM citations WHERE cited_id = ?')
    .all(citedId) as { citing_id: string }[];
  return rows.map((r) => r.citing_id as PaperId);
}

export function deleteCitation(
  db: Database.Database,
  citingId: PaperId,
  citedId: PaperId,
): number {
  return db
    .prepare(
      'DELETE FROM citations WHERE citing_id = ? AND cited_id = ?',
    )
    .run(citingId, citedId).changes;
}
