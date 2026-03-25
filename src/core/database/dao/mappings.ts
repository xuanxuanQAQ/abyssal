// ═══ 论文-概念映射 CRUD ═══

import type Database from 'better-sqlite3';
import type { PaperId, ConceptId, AnnotationId } from '../../types/common';
import type { ConceptMapping, RelationType, BilingualEvidence } from '../../types/mapping';
import { fromRow, now } from '../row-mapper';

// ─── mapPaperConcept (UPSERT) ───

export function mapPaperConcept(
  db: Database.Database,
  mapping: ConceptMapping,
): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO paper_concept_map (
      paper_id, concept_id, relation, confidence, evidence,
      annotation_id, reviewed, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(paper_id, concept_id) DO UPDATE SET
      relation = excluded.relation,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      annotation_id = COALESCE(excluded.annotation_id, paper_concept_map.annotation_id),
      reviewed = excluded.reviewed,
      reviewed_at = excluded.reviewed_at,
      updated_at = excluded.updated_at
  `).run(
    mapping.paperId,
    mapping.conceptId,
    mapping.relation,
    mapping.confidence,
    JSON.stringify(mapping.evidence),
    mapping.annotationId,
    mapping.reviewed ? 1 : 0,
    mapping.reviewedAt,
    timestamp,
    timestamp,
  );
}

// ─── updateMapping (部分更新) ───

export function updateMapping(
  db: Database.Database,
  paperId: PaperId,
  conceptId: ConceptId,
  updates: {
    relation?: RelationType;
    confidence?: number;
    evidence?: BilingualEvidence;
    reviewed?: boolean;
    reviewedAt?: string | null;
  },
): number {
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now()];

  if (updates.relation !== undefined) {
    setClauses.push('relation = ?');
    params.push(updates.relation);
  }
  if (updates.confidence !== undefined) {
    setClauses.push('confidence = ?');
    params.push(updates.confidence);
  }
  if (updates.evidence !== undefined) {
    setClauses.push('evidence = ?');
    params.push(JSON.stringify(updates.evidence));
  }
  if (updates.reviewed !== undefined) {
    setClauses.push('reviewed = ?');
    params.push(updates.reviewed ? 1 : 0);
  }
  if (updates.reviewedAt !== undefined) {
    setClauses.push('reviewed_at = ?');
    params.push(updates.reviewedAt);
  }

  params.push(paperId, conceptId);

  return db
    .prepare(
      `UPDATE paper_concept_map SET ${setClauses.join(', ')} WHERE paper_id = ? AND concept_id = ?`,
    )
    .run(...params).changes;
}

// ─── 查询 ───

export function getMappingsByPaper(
  db: Database.Database,
  paperId: PaperId,
): ConceptMapping[] {
  const rows = db
    .prepare('SELECT * FROM paper_concept_map WHERE paper_id = ? ORDER BY confidence DESC')
    .all(paperId) as Record<string, unknown>[];
  return rows.map((r) => fromRow<ConceptMapping>(r));
}

export function getMappingsByConcept(
  db: Database.Database,
  conceptId: ConceptId,
): ConceptMapping[] {
  const rows = db
    .prepare('SELECT * FROM paper_concept_map WHERE concept_id = ? ORDER BY confidence DESC')
    .all(conceptId) as Record<string, unknown>[];
  return rows.map((r) => fromRow<ConceptMapping>(r));
}

export function getMapping(
  db: Database.Database,
  paperId: PaperId,
  conceptId: ConceptId,
): ConceptMapping | null {
  const row = db
    .prepare('SELECT * FROM paper_concept_map WHERE paper_id = ? AND concept_id = ?')
    .get(paperId, conceptId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<ConceptMapping>(row);
}

export function deleteMapping(
  db: Database.Database,
  paperId: PaperId,
  conceptId: ConceptId,
): number {
  return db
    .prepare('DELETE FROM paper_concept_map WHERE paper_id = ? AND concept_id = ?')
    .run(paperId, conceptId).changes;
}

// ─── 概念矩阵（热力图数据） ───

export interface ConceptMatrixEntry {
  paperId: PaperId;
  conceptId: ConceptId;
  relation: RelationType;
  confidence: number;
  reviewed: boolean;
}

export function getConceptMatrix(
  db: Database.Database,
): ConceptMatrixEntry[] {
  const rows = db
    .prepare(`
      SELECT paper_id, concept_id, relation, confidence, reviewed
      FROM paper_concept_map
      WHERE concept_id IN (SELECT id FROM concepts WHERE deprecated = 0)
      ORDER BY paper_id, concept_id
    `)
    .all() as Record<string, unknown>[];
  return rows.map((r) => fromRow<ConceptMatrixEntry>(r));
}
