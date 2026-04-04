// ═══ References DAO ═══
// 参考文献提取结果的持久化与查询

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import type { ExtractedReference } from '../../process';

// ─── 数据库行类型 ───

export interface ReferenceRow {
  id: number;
  paperId: string;
  orderIndex: number;
  rawText: string;
  doi: string | null;
  year: number | null;
  roughAuthors: string | null;
  roughTitle: string | null;
  resolvedPaperId: string | null;
  createdAt: string;
}

// ─── 水合日志行类型 ───

export interface HydrateLogRow {
  id: number;
  paperId: string;
  fieldName: string;
  fieldValue: string | null;
  source: string;
  createdAt: string;
}

// ─── 写入 ───

/** 批量写入提取的参考文献（先删除该论文旧条目） */
export function upsertReferences(
  db: Database.Database,
  paperId: PaperId,
  refs: ExtractedReference[],
): number {
  if (refs.length === 0) return 0;

  const del = db.prepare('DELETE FROM extracted_references WHERE paper_id = ?');
  const ins = db.prepare(`
    INSERT INTO extracted_references (paper_id, order_index, raw_text, doi, year, rough_authors, rough_title)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    del.run(paperId);
    let count = 0;
    for (const ref of refs) {
      ins.run(paperId, ref.orderIndex, ref.rawText, ref.doi, ref.year, ref.roughAuthors, ref.roughTitle);
      count++;
    }
    return count;
  });

  return tx();
}

/** 记录水合审计日志 */
export function insertHydrateLogs(
  db: Database.Database,
  paperId: PaperId,
  logs: Array<{ field: string; value: unknown; source: string }>,
): void {
  if (logs.length === 0) return;

  const ins = db.prepare(`
    INSERT INTO hydrate_log (paper_id, field_name, field_value, source)
    VALUES (?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const log of logs) {
      const val = log.value === null || log.value === undefined
        ? null
        : typeof log.value === 'string' ? log.value : JSON.stringify(log.value);
      ins.run(paperId, log.field, val, log.source);
    }
  });

  tx();
}

// ─── 查询 ───

/** 获取论文的参考文献列表 */
export function getReferencesByPaper(
  db: Database.Database,
  paperId: PaperId,
): ReferenceRow[] {
  return db.prepare(`
    SELECT id, paper_id AS paperId, order_index AS orderIndex, raw_text AS rawText,
           doi, year, rough_authors AS roughAuthors, rough_title AS roughTitle,
           resolved_paper_id AS resolvedPaperId, created_at AS createdAt
    FROM extracted_references
    WHERE paper_id = ?
    ORDER BY order_index
  `).all(paperId) as ReferenceRow[];
}

/** 获取论文的水合日志 */
export function getHydrateLog(
  db: Database.Database,
  paperId: PaperId,
): HydrateLogRow[] {
  return db.prepare(`
    SELECT id, paper_id AS paperId, field_name AS fieldName,
           field_value AS fieldValue, source, created_at AS createdAt
    FROM hydrate_log
    WHERE paper_id = ?
    ORDER BY created_at
  `).all(paperId) as HydrateLogRow[];
}

/** 查找参考文献中有 DOI 但未关联到库中论文的条目 */
export function getUnresolvedRefsWithDoi(
  db: Database.Database,
  paperId: PaperId,
): ReferenceRow[] {
  return db.prepare(`
    SELECT id, paper_id AS paperId, order_index AS orderIndex, raw_text AS rawText,
           doi, year, rough_authors AS roughAuthors, rough_title AS roughTitle,
           resolved_paper_id AS resolvedPaperId, created_at AS createdAt
    FROM extracted_references
    WHERE paper_id = ? AND doi IS NOT NULL AND resolved_paper_id IS NULL
    ORDER BY order_index
  `).all(paperId) as ReferenceRow[];
}

/** 将参考文献关联到已有论文 */
export function resolveReference(
  db: Database.Database,
  refId: number,
  resolvedPaperId: PaperId,
): void {
  db.prepare('UPDATE extracted_references SET resolved_paper_id = ? WHERE id = ?')
    .run(resolvedPaperId, refId);
}
