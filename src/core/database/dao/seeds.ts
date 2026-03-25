// ═══ 种子论文 CRUD ═══

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import type { SeedType } from '../../types/config';
import { now } from '../row-mapper';

export interface Seed {
  paperId: PaperId;
  seedType: SeedType;
  addedAt: string;
}

export function addSeed(
  db: Database.Database,
  paperId: PaperId,
  seedType: SeedType,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO seeds (paper_id, seed_type, added_at) VALUES (?, ?, ?)',
  ).run(paperId, seedType, now());
}

export function getSeeds(db: Database.Database): Seed[] {
  const rows = db
    .prepare('SELECT * FROM seeds ORDER BY added_at')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    paperId: r['paper_id'] as PaperId,
    seedType: r['seed_type'] as SeedType,
    addedAt: r['added_at'] as string,
  }));
}

export function removeSeed(
  db: Database.Database,
  paperId: PaperId,
): number {
  return db.prepare('DELETE FROM seeds WHERE paper_id = ?').run(paperId).changes;
}
