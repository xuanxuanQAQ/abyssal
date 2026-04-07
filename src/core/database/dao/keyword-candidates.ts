// ═══ Keyword Candidates DAO ═══
// addOrMergeCandidate / getCandidatesForConcept / acceptCandidate / rejectCandidate / getCandidateStats

import type Database from 'better-sqlite3';
import type { ConceptId } from '../../types/common';
import { now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';

export interface KeywordCandidateRow {
  id: number;
  conceptId: string;
  term: string;
  sourceCount: number;
  sourcePaperIds: string[];
  confidence: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

// ─── row mapping helpers ───

interface RawRow {
  id: number;
  concept_id: string;
  term: string;
  source_count: number;
  source_paper_ids: string;
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(raw: RawRow): KeywordCandidateRow {
  return {
    id: raw.id,
    conceptId: raw.concept_id,
    term: raw.term,
    sourceCount: raw.source_count,
    sourcePaperIds: JSON.parse(raw.source_paper_ids),
    confidence: raw.confidence,
    status: raw.status as KeywordCandidateRow['status'],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// ─── addOrMergeCandidate ───

export function addOrMergeCandidate(
  db: Database.Database,
  conceptId: ConceptId,
  term: string,
  paperId: string,
  confidence: number,
): KeywordCandidateRow {
  return writeTransaction(db, () => {
    const existing = db.prepare(`
      SELECT * FROM keyword_candidates
      WHERE concept_id = ? AND term = ? AND status = 'pending'
    `).get(conceptId, term) as RawRow | undefined;

    if (existing) {
      const ids: string[] = JSON.parse(existing.source_paper_ids);
      if (!ids.includes(paperId)) ids.push(paperId);
      const newConfidence = Math.max(existing.confidence, confidence);
      const ts = now();

      db.prepare(`
        UPDATE keyword_candidates
        SET source_count = ?, source_paper_ids = ?, confidence = ?, updated_at = ?
        WHERE id = ?
      `).run(ids.length, JSON.stringify(ids), newConfidence, ts, existing.id);

      return mapRow({
        ...existing,
        source_count: ids.length,
        source_paper_ids: JSON.stringify(ids),
        confidence: newConfidence,
        updated_at: ts,
      });
    }

    const ts = now();
    const result = db.prepare(`
      INSERT INTO keyword_candidates (concept_id, term, source_count, source_paper_ids, confidence, status, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, 'pending', ?, ?)
    `).run(conceptId, term, JSON.stringify([paperId]), confidence, ts, ts);

    return mapRow({
      id: Number(result.lastInsertRowid),
      concept_id: conceptId,
      term,
      source_count: 1,
      source_paper_ids: JSON.stringify([paperId]),
      confidence,
      status: 'pending',
      created_at: ts,
      updated_at: ts,
    });
  });
}

// ─── getCandidatesForConcept ───

export function getCandidatesForConcept(
  db: Database.Database,
  conceptId: ConceptId,
  status: KeywordCandidateRow['status'] = 'pending',
): KeywordCandidateRow[] {
  const rows = db.prepare(`
    SELECT * FROM keyword_candidates
    WHERE concept_id = ? AND status = ?
    ORDER BY source_count DESC
  `).all(conceptId, status) as RawRow[];

  return rows.map(mapRow);
}

// ─── acceptCandidate ───

export function acceptCandidate(
  db: Database.Database,
  candidateId: number,
): string {
  return writeTransaction(db, () => {
    const row = db.prepare(
      "SELECT term FROM keyword_candidates WHERE id = ? AND status = 'pending'",
    ).get(candidateId) as { term: string } | undefined;
    if (!row) throw new Error(`keyword_candidate ${candidateId} not found or not pending`);

    db.prepare(
      "UPDATE keyword_candidates SET status = 'accepted', updated_at = ? WHERE id = ?",
    ).run(now(), candidateId);

    return row.term;
  });
}

// ─── rejectCandidate ───

export function rejectCandidate(
  db: Database.Database,
  candidateId: number,
): void {
  const result = db.prepare(
    "UPDATE keyword_candidates SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending'",
  ).run(now(), candidateId);
  if (result.changes === 0) throw new Error(`keyword_candidate ${candidateId} not found or not pending`);
}

// ─── getCandidateStats ───

export function getCandidateStats(
  db: Database.Database,
  conceptId: ConceptId,
): { pending: number; accepted: number; rejected: number } {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS cnt
    FROM keyword_candidates
    WHERE concept_id = ?
    GROUP BY status
  `).all(conceptId) as { status: string; cnt: number }[];

  const stats = { pending: 0, accepted: 0, rejected: 0 };
  for (const r of rows) {
    if (r.status in stats) stats[r.status as keyof typeof stats] = r.cnt;
  }
  return stats;
}
