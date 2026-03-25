// ═══ 碎片笔记管理 ═══
// §5: addMemo / updateMemo / getMemosByEntity / deleteMemo

import type Database from 'better-sqlite3';
import type { MemoId, PaperId, ConceptId, AnnotationId, OutlineEntryId, NoteId } from '../../types/common';
import type { ResearchMemo } from '../../types/memo';
import type { TextChunk } from '../../types/chunk';
import { asMemoId, asChunkId } from '../../types/common';
import { fromRow, now } from '../row-mapper';
import { insertChunk, insertChunkTextOnly, deleteChunksByPrefix } from './chunks';

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

  const addFn = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO research_memos (
        text, paper_ids, concept_ids, annotation_id, outline_id,
        linked_note_ids, tags, indexed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    );

    const memoId = Number(result.lastInsertRowid);
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

  return addFn();
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
    const updateFn = db.transaction(() => {
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

    return updateFn();
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

  return db
    .prepare(`UPDATE research_memos SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params).changes;
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
      sql = `SELECT * FROM research_memos
             WHERE id IN (SELECT m.id FROM research_memos m, json_each(m.paper_ids) je WHERE je.value = ?)
             ORDER BY created_at DESC`;
      break;
    case 'concept':
      sql = `SELECT * FROM research_memos
             WHERE id IN (SELECT m.id FROM research_memos m, json_each(m.concept_ids) je WHERE je.value = ?)
             ORDER BY created_at DESC`;
      break;
    case 'annotation':
      sql = 'SELECT * FROM research_memos WHERE annotation_id = ? ORDER BY created_at DESC';
      break;
    case 'outline':
      sql = 'SELECT * FROM research_memos WHERE outline_id = ? ORDER BY created_at DESC';
      break;
    case 'note':
      sql = `SELECT * FROM research_memos
             WHERE id IN (SELECT m.id FROM research_memos m, json_each(m.linked_note_ids) je WHERE je.value = ?)
             ORDER BY created_at DESC`;
      break;
  }

  const rows = db.prepare(sql).all(entityId) as Record<string, unknown>[];
  return rows.map((r) => fromRow<ResearchMemo>(r));
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
  return fromRow<ResearchMemo>(row);
}

// ─── §5.4 deleteMemo ───

export function deleteMemo(
  db: Database.Database,
  id: MemoId,
): number {
  const deleteFn = db.transaction(() => {
    deleteChunksByPrefix(db, `memo__${id}`);
    return db.prepare('DELETE FROM research_memos WHERE id = ?').run(id).changes;
  });

  return deleteFn();
}
