// ═══ 论文分析基础 CRUD ═══
// upsertAnalysisBase / getAnalysisBase / getAnalysisBaseForPapers / hasAnalysisBase / deleteAnalysisBase

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import { now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';

// ─── 类型定义 ───

export interface PaperAnalysisBase {
  paperId: string;
  claims: string[];
  methodTags: string[];
  keyTerms: string[];
  contributionSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisBaseData {
  claims: string[];
  methodTags: string[];
  keyTerms: string[];
  contributionSummary: string | null;
}

// ─── 行转换 ───

function fromRow(row: Record<string, unknown>): PaperAnalysisBase {
  return {
    paperId: row.paper_id as string,
    claims: JSON.parse(row.claims as string),
    methodTags: JSON.parse(row.method_tags as string),
    keyTerms: JSON.parse(row.key_terms as string),
    contributionSummary: (row.contribution_summary as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── upsertAnalysisBase ───

export function upsertAnalysisBase(
  db: Database.Database,
  paperId: PaperId,
  data: AnalysisBaseData,
): void {
  const timestamp = now();
  writeTransaction(db, () => {
    db.prepare(`
      INSERT INTO paper_analysis_base (paper_id, claims, method_tags, key_terms, contribution_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(paper_id) DO UPDATE SET
        claims = excluded.claims,
        method_tags = excluded.method_tags,
        key_terms = excluded.key_terms,
        contribution_summary = excluded.contribution_summary,
        updated_at = excluded.updated_at
    `).run(
      paperId,
      JSON.stringify(data.claims),
      JSON.stringify(data.methodTags),
      JSON.stringify(data.keyTerms),
      data.contributionSummary,
      timestamp,
      timestamp,
    );
  });
}

// ─── getAnalysisBase ───

export function getAnalysisBase(
  db: Database.Database,
  paperId: PaperId,
): PaperAnalysisBase | null {
  const row = db.prepare('SELECT * FROM paper_analysis_base WHERE paper_id = ?').get(paperId) as
    | Record<string, unknown>
    | undefined;
  return row ? fromRow(row) : null;
}

// ─── getAnalysisBaseForPapers ───

export function getAnalysisBaseForPapers(
  db: Database.Database,
  paperIds: PaperId[],
): PaperAnalysisBase[] {
  if (paperIds.length === 0) return [];
  const placeholders = paperIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM paper_analysis_base WHERE paper_id IN (${placeholders})`)
    .all(...paperIds) as Record<string, unknown>[];
  return rows.map(fromRow);
}

// ─── hasAnalysisBase ───

export function hasAnalysisBase(
  db: Database.Database,
  paperId: PaperId,
): boolean {
  const row = db
    .prepare('SELECT 1 FROM paper_analysis_base WHERE paper_id = ?')
    .get(paperId);
  return row !== undefined;
}

// ─── deleteAnalysisBase ───

export function deleteAnalysisBase(
  db: Database.Database,
  paperId: PaperId,
): void {
  db.prepare('DELETE FROM paper_analysis_base WHERE paper_id = ?').run(paperId);
}
