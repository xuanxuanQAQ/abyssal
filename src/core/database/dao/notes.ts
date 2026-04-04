// ═══ 结构化笔记管理 ═══
// §6: createNote / saveNoteContent / upgradeFromMemo / upgradeToTentativeConcept
//
// 笔记内容以 ProseMirror JSON 格式存储在 document_json 列中。
// 文件系统不再参与笔记存储。

import type Database from 'better-sqlite3';
import type { NoteId, PaperId, ConceptId, MemoId } from '../../types/common';
import type { ResearchNote } from '../../types/note';
import type { TextChunk } from '../../types/chunk';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';
import { insertChunksBatch, deleteChunksByPrefix } from './chunks';

// ─── §6.1 createNote ───

export function createNote(
  db: Database.Database,
  note: Omit<ResearchNote, 'createdAt' | 'updatedAt'>,
  chunks: TextChunk[],
  embeddings: (Float32Array | null)[],
): void {
  const timestamp = now();

  writeTransaction(db, () => {
    db.prepare(`
      INSERT INTO research_notes (
        id, file_path, title, linked_paper_ids, linked_concept_ids,
        tags, document_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.id,
      note.filePath,
      note.title,
      JSON.stringify(note.linkedPaperIds),
      JSON.stringify(note.linkedConceptIds),
      JSON.stringify(note.tags),
      note.documentJson ?? null,
      timestamp,
      timestamp,
    );

    if (chunks.length > 0) {
      insertChunksBatch(db, chunks, embeddings);
    }
  });
}

// ─── §6.2 saveNoteContent ───

export function saveNoteContent(
  db: Database.Database,
  noteId: NoteId,
  documentJson: string,
  chunks: TextChunk[],
  embeddings: (Float32Array | null)[],
): void {
  const timestamp = now();

  writeTransaction(db, () => {
    db.prepare(`
      UPDATE research_notes
      SET document_json = ?, updated_at = ?
      WHERE id = ?
    `).run(documentJson, timestamp, noteId);

    // 删除旧 chunk + vec
    deleteChunksByPrefix(db, `note__${noteId}__`);

    // 写入新 chunk + vec
    if (chunks.length > 0) {
      insertChunksBatch(db, chunks, embeddings);
    }
  });
}

// ─── §6.3 upgradeFromMemo ───
// 文件系统操作由调用方在事务外完成

export interface UpgradeFromMemoResult {
  noteId: NoteId;
  filePath: string;
}

export function linkMemoToNote(
  db: Database.Database,
  memoId: MemoId,
  noteId: NoteId,
): void {
  // Check existing links to prevent duplicates
  const row = db.prepare('SELECT linked_note_ids FROM research_memos WHERE id = ?')
    .get(memoId) as { linked_note_ids: string } | undefined;
  if (!row) return;

  try {
    const existing: string[] = JSON.parse(row.linked_note_ids);
    if (existing.includes(noteId)) return;
  } catch { /* proceed with insert */ }

  const timestamp = now();
  db.prepare(`
    UPDATE research_memos
    SET linked_note_ids = json_insert(linked_note_ids, '$[#]', ?),
        updated_at = ?
    WHERE id = ?
  `).run(noteId, timestamp, memoId);
}

// ─── §6.4 upgradeToTentativeConcept ───
// Markdown 文件读取由调用方（Orchestrator）完成，DAO 仅处理 DB 操作。

export function linkNoteToConcept(
  db: Database.Database,
  noteId: NoteId,
  conceptId: ConceptId,
): void {
  const note = getNote(db, noteId);
  if (!note) return;

  // Prevent duplicate links
  if (note.linkedConceptIds.includes(conceptId)) return;

  const timestamp = now();
  db.prepare(`
    UPDATE research_notes
    SET linked_concept_ids = json_insert(linked_concept_ids, '$[#]', ?),
        updated_at = ?
    WHERE id = ?
  `).run(conceptId, timestamp, noteId);
}

// ─── §6.5 updateNoteMeta ───

export function updateNoteMeta(
  db: Database.Database,
  id: NoteId,
  updates: Partial<Pick<ResearchNote, 'title' | 'linkedPaperIds' | 'linkedConceptIds' | 'tags'>>,
): ResearchNote | null {
  const timestamp = now();

  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [timestamp];

  if (updates.title !== undefined) { setClauses.push('title = ?'); params.push(updates.title); }
  if (updates.linkedPaperIds !== undefined) { setClauses.push('linked_paper_ids = ?'); params.push(JSON.stringify(updates.linkedPaperIds)); }
  if (updates.linkedConceptIds !== undefined) { setClauses.push('linked_concept_ids = ?'); params.push(JSON.stringify(updates.linkedConceptIds)); }
  if (updates.tags !== undefined) { setClauses.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }

  params.push(id);

  db.prepare(
    `UPDATE research_notes SET ${setClauses.join(', ')} WHERE id = ?`,
  ).run(...params);

  return getNote(db, id);
}

// ─── §6.6 queryNotes (with filter) ───

export function queryNotes(
  db: Database.Database,
  filter?: {
    conceptIds?: string[];
    paperIds?: string[];
    tags?: string[];
    searchText?: string;
  },
): ResearchNote[] {
  if (!filter) return getAllNotes(db);

  let sql = 'SELECT * FROM research_notes WHERE 1=1';
  const params: unknown[] = [];

  if (filter.searchText) {
    sql += ' AND title LIKE ?';
    params.push(`%${filter.searchText}%`);
  }

  // JSON array filtering via json_each
  if (filter.conceptIds && filter.conceptIds.length > 0) {
    const placeholders = filter.conceptIds.map(() => '?').join(',');
    sql += ` AND EXISTS (
      SELECT 1 FROM json_each(linked_concept_ids) je
      WHERE je.value IN (${placeholders})
    )`;
    params.push(...filter.conceptIds);
  }

  if (filter.paperIds && filter.paperIds.length > 0) {
    const placeholders = filter.paperIds.map(() => '?').join(',');
    sql += ` AND EXISTS (
      SELECT 1 FROM json_each(linked_paper_ids) je
      WHERE je.value IN (${placeholders})
    )`;
    params.push(...filter.paperIds);
  }

  if (filter.tags && filter.tags.length > 0) {
    const placeholders = filter.tags.map(() => '?').join(',');
    sql += ` AND EXISTS (
      SELECT 1 FROM json_each(tags) je
      WHERE je.value IN (${placeholders})
    )`;
    params.push(...filter.tags);
  }

  sql += ' ORDER BY updated_at DESC';

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((r) => fromRow<ResearchNote>(r));
}

// ─── 查询 ───

export function getNote(
  db: Database.Database,
  id: NoteId,
): ResearchNote | null {
  const row = db
    .prepare('SELECT * FROM research_notes WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<ResearchNote>(row);
}

export function getAllNotes(
  db: Database.Database,
): ResearchNote[] {
  const rows = db
    .prepare('SELECT * FROM research_notes ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => fromRow<ResearchNote>(r));
}

export function deleteNote(
  db: Database.Database,
  id: NoteId,
): number {
  return writeTransaction(db, () => {
    deleteChunksByPrefix(db, `note__${id}__`);
    return db.prepare('DELETE FROM research_notes WHERE id = ?').run(id).changes;
  });
}
