// ═══ 碎片笔记管理 ═══
// §5: addMemo / updateMemo / getMemosByEntity / deleteMemo

import type Database from 'better-sqlite3';
import type { MemoId } from '../../types/common';
import type { ResearchMemo } from '../../types/memo';
import type { TextChunk } from '../../types/chunk';
import { asMemoId, asChunkId } from '../../types/common';
import { now } from '../row-mapper';
import { safeFromRow, MemoRowSchema } from '../schemas';
import { writeTransaction } from '../transaction-utils';
import { insertChunk, insertChunkTextOnly, deleteChunksByPrefix } from './chunks';

/** 安全解析 JSON 数组——DB 数据损坏时返回空数组而非 crash */
function safeParseArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── 映射表同步辅助 ───

function syncMemoMaps(
  db: Database.Database,
  memoId: number,
  paperIds: string[],
  conceptIds: string[],
  noteIds: string[],
): void {
  db.prepare('DELETE FROM memo_paper_map WHERE memo_id = ?').run(memoId);
  db.prepare('DELETE FROM memo_concept_map WHERE memo_id = ?').run(memoId);
  db.prepare('DELETE FROM memo_note_map WHERE memo_id = ?').run(memoId);

  const insPaper = db.prepare('INSERT INTO memo_paper_map (memo_id, paper_id) VALUES (?, ?)');
  const insConcept = db.prepare('INSERT INTO memo_concept_map (memo_id, concept_id) VALUES (?, ?)');
  const insNote = db.prepare('INSERT INTO memo_note_map (memo_id, note_id) VALUES (?, ?)');

  for (const pid of paperIds) insPaper.run(memoId, pid);
  for (const cid of conceptIds) insConcept.run(memoId, cid);
  for (const nid of noteIds) insNote.run(memoId, nid);
}

// ─── §5.1 addMemo ───

export interface AddMemoResult {
  memoId: MemoId;
  chunkRowid: number;
}

/**
 * 创建碎片笔记 + chunk 文本行。
 *
 * embedding 为 null 时仅写文本（indexed=0），向量稍后由 Worker 写入。
 * 返回 memoId 和 chunkRowid，调用方可将 rowid 传给 Worker 执行 insertChunkVectors。
 */
export function addMemo(
  db: Database.Database,
  memo: Omit<ResearchMemo, 'id' | 'createdAt' | 'updatedAt'>,
  embedding: Float32Array | null,
): AddMemoResult {
  const timestamp = now();

  return writeTransaction(db, () => {
    const insertedRow = db.prepare(`
      INSERT INTO research_memos (
        text, paper_ids, concept_ids, annotation_id, outline_id,
        linked_note_ids, tags, indexed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).get(
      memo.text,
      JSON.stringify(memo.paperIds),
      JSON.stringify(memo.conceptIds),
      memo.annotationId,
      memo.outlineId,
      JSON.stringify(memo.linkedNoteIds),
      JSON.stringify(memo.tags),
      embedding ? 1 : 0,
      timestamp,
      timestamp,
    ) as { id: number };

    const memoId = insertedRow.id;

    // 同步映射表
    syncMemoMaps(db, memoId, memo.paperIds, memo.conceptIds, memo.linkedNoteIds);

    const chunkId = asChunkId(`memo__${memoId}`);

    const chunk: TextChunk = {
      chunkId,
      paperId: null,
      sectionLabel: null,
      sectionTitle: null,
      sectionType: null,
      pageStart: null,
      pageEnd: null,
      text: memo.text,
      tokenCount: Math.ceil(memo.text.length / 4), // 粗估
      source: 'memo',
      positionRatio: null,
      parentChunkId: null,
      chunkIndex: null,
      contextBefore: null,
      contextAfter: null,
    };

    // embedding 非空时直接写入 vec（小数据量，可在主线程完成）。
    // embedding 为空时仅写文本，调用方负责后续 Worker 写入。
    const chunkRowid = embedding
      ? insertChunk(db, chunk, embedding)
      : insertChunkTextOnly(db, chunk);

    return { memoId: asMemoId(String(memoId)), chunkRowid };
  });
}

/** 标记 memo 的索引状态为已完成（Worker 写入向量后回调） */
export function markMemoIndexed(
  db: Database.Database,
  id: MemoId,
): void {
  db.prepare('UPDATE research_memos SET indexed = 1, updated_at = ? WHERE id = ?')
    .run(now(), id);
}

// ─── §5.2 updateMemo ───

export function updateMemo(
  db: Database.Database,
  id: MemoId,
  updates: Partial<Pick<ResearchMemo, 'text' | 'paperIds' | 'conceptIds' | 'annotationId' | 'outlineId' | 'linkedNoteIds' | 'tags'>>,
  newEmbedding?: Float32Array | null,
): number {
  const timestamp = now();

  // text 字段变更需要重建 chunk
  if (updates.text !== undefined) {
    return writeTransaction(db, () => {
      // 删除旧 chunk
      deleteChunksByPrefix(db, `memo__${id}`);

      // 构造 SET 子句
      const setClauses: string[] = ['text = ?', 'updated_at = ?'];
      const params: unknown[] = [updates.text, timestamp];

      if (updates.paperIds !== undefined) { setClauses.push('paper_ids = ?'); params.push(JSON.stringify(updates.paperIds)); }
      if (updates.conceptIds !== undefined) { setClauses.push('concept_ids = ?'); params.push(JSON.stringify(updates.conceptIds)); }
      if (updates.annotationId !== undefined) { setClauses.push('annotation_id = ?'); params.push(updates.annotationId); }
      if (updates.outlineId !== undefined) { setClauses.push('outline_id = ?'); params.push(updates.outlineId); }
      if (updates.linkedNoteIds !== undefined) { setClauses.push('linked_note_ids = ?'); params.push(JSON.stringify(updates.linkedNoteIds)); }
      if (updates.tags !== undefined) { setClauses.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }

      const hasEmbedding = newEmbedding != null;
      setClauses.push('indexed = ?');
      params.push(hasEmbedding ? 1 : 0);

      params.push(id);

      const result = db.prepare(
        `UPDATE research_memos SET ${setClauses.join(', ')} WHERE id = ?`,
      ).run(...params);

      // 同步映射表（取最新值，未更新的字段从当前行读取）
      if (updates.paperIds !== undefined || updates.conceptIds !== undefined || updates.linkedNoteIds !== undefined) {
        const current = db.prepare('SELECT paper_ids, concept_ids, linked_note_ids FROM research_memos WHERE id = ?')
          .get(id) as { paper_ids: string; concept_ids: string; linked_note_ids: string } | undefined;
        if (current) {
          syncMemoMaps(
            db, Number(id),
            updates.paperIds ?? safeParseArray(current.paper_ids),
            updates.conceptIds ?? safeParseArray(current.concept_ids),
            updates.linkedNoteIds ?? safeParseArray(current.linked_note_ids),
          );
        }
      }

      // 重新 INSERT chunk + vec
      const chunkId = asChunkId(`memo__${id}`);
      const chunk: TextChunk = {
        chunkId,
        paperId: null,
        sectionLabel: null,
        sectionTitle: null,
        sectionType: null,
        pageStart: null,
        pageEnd: null,
        text: updates.text!,
        tokenCount: Math.ceil(updates.text!.length / 4),
        source: 'memo',
        positionRatio: null,
        parentChunkId: null,
        chunkIndex: null,
        contextBefore: null,
        contextAfter: null,
      };

      insertChunk(db, chunk, newEmbedding ?? null);

      return result.changes;
    });
  }

  // 仅更新关联字段
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [timestamp];

  if (updates.paperIds !== undefined) { setClauses.push('paper_ids = ?'); params.push(JSON.stringify(updates.paperIds)); }
  if (updates.conceptIds !== undefined) { setClauses.push('concept_ids = ?'); params.push(JSON.stringify(updates.conceptIds)); }
  if (updates.annotationId !== undefined) { setClauses.push('annotation_id = ?'); params.push(updates.annotationId); }
  if (updates.outlineId !== undefined) { setClauses.push('outline_id = ?'); params.push(updates.outlineId); }
  if (updates.linkedNoteIds !== undefined) { setClauses.push('linked_note_ids = ?'); params.push(JSON.stringify(updates.linkedNoteIds)); }
  if (updates.tags !== undefined) { setClauses.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }

  params.push(id);

  const changes = db
    .prepare(`UPDATE research_memos SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params).changes;

  // 同步映射表
  if (updates.paperIds !== undefined || updates.conceptIds !== undefined || updates.linkedNoteIds !== undefined) {
    const current = db.prepare('SELECT paper_ids, concept_ids, linked_note_ids FROM research_memos WHERE id = ?')
      .get(id) as { paper_ids: string; concept_ids: string; linked_note_ids: string } | undefined;
    if (current) {
      syncMemoMaps(
        db, Number(id),
        updates.paperIds ?? safeParseArray(current.paper_ids),
        updates.conceptIds ?? safeParseArray(current.concept_ids),
        updates.linkedNoteIds ?? safeParseArray(current.linked_note_ids),
      );
    }
  }

  return changes;
}

// ─── §5.3 getMemosByEntity ───

export type MemoEntityType = 'paper' | 'concept' | 'annotation' | 'outline' | 'note';

export function getMemosByEntity(
  db: Database.Database,
  entityType: MemoEntityType,
  entityId: string | number,
): ResearchMemo[] {
  let sql: string;

  switch (entityType) {
    case 'paper':
      sql = `SELECT m.* FROM research_memos m
             JOIN memo_paper_map mp ON mp.memo_id = m.id
             WHERE mp.paper_id = ?
             ORDER BY m.created_at DESC`;
      break;
    case 'concept':
      sql = `SELECT m.* FROM research_memos m
             JOIN memo_concept_map mc ON mc.memo_id = m.id
             WHERE mc.concept_id = ?
             ORDER BY m.created_at DESC`;
      break;
    case 'annotation':
      sql = 'SELECT * FROM research_memos WHERE annotation_id = ? ORDER BY created_at DESC';
      break;
    case 'outline':
      sql = 'SELECT * FROM research_memos WHERE outline_id = ? ORDER BY created_at DESC';
      break;
    case 'note':
      sql = `SELECT m.* FROM research_memos m
             JOIN memo_note_map mn ON mn.memo_id = m.id
             WHERE mn.note_id = ?
             ORDER BY m.created_at DESC`;
      break;
  }

  const rows = db.prepare(sql).all(entityId) as Record<string, unknown>[];
  return rows.map((r) => safeFromRow<ResearchMemo>(r, MemoRowSchema));
}

// ─── queryMemos (with filter + pagination) ───

export function queryMemos(
  db: Database.Database,
  filter?: {
    paperIds?: string[];
    conceptIds?: string[];
    tags?: string[];
    searchText?: string;
    limit?: number;
    offset?: number;
  },
): ResearchMemo[] {
  let sql = 'SELECT * FROM research_memos WHERE 1=1';
  const params: unknown[] = [];

  if (filter?.searchText) {
    sql += ' AND text LIKE ?';
    params.push(`%${filter.searchText}%`);
  }

  if (filter?.paperIds && filter.paperIds.length > 0) {
    const placeholders = filter.paperIds.map(() => '?').join(',');
    sql += ` AND EXISTS (
      SELECT 1 FROM memo_paper_map mp
      WHERE mp.memo_id = research_memos.id AND mp.paper_id IN (${placeholders})
    )`;
    params.push(...filter.paperIds);
  }

  if (filter?.conceptIds && filter.conceptIds.length > 0) {
    const placeholders = filter.conceptIds.map(() => '?').join(',');
    sql += ` AND EXISTS (
      SELECT 1 FROM memo_concept_map mc
      WHERE mc.memo_id = research_memos.id AND mc.concept_id IN (${placeholders})
    )`;
    params.push(...filter.conceptIds);
  }

  if (filter?.tags && filter.tags.length > 0) {
    const placeholders = filter.tags.map(() => '?').join(',');
    sql += ` AND EXISTS (
      SELECT 1 FROM json_each(tags) je
      WHERE je.value IN (${placeholders})
    )`;
    params.push(...filter.tags);
  }

  sql += ' ORDER BY created_at DESC';

  const limit = filter?.limit ?? 50;
  const offset = filter?.offset ?? 0;
  sql += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((r) => safeFromRow<ResearchMemo>(r, MemoRowSchema));
}

// ─── getMemo ───

export function getMemo(
  db: Database.Database,
  id: MemoId,
): ResearchMemo | null {
  const row = db
    .prepare('SELECT * FROM research_memos WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return safeFromRow<ResearchMemo>(row, MemoRowSchema);
}

// ─── §5.4 deleteMemo ───

export function deleteMemo(
  db: Database.Database,
  id: MemoId,
): number {
  return writeTransaction(db, () => {
    deleteChunksByPrefix(db, `memo__${id}`);
    // 映射表通过 ON DELETE CASCADE 自动清理
    return db.prepare('DELETE FROM research_memos WHERE id = ?').run(id).changes;
  });
}
