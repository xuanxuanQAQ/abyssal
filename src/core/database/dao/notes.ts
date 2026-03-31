// ═══ 结构化笔记管理 ═══
// §6: createNote / onNoteFileChanged / upgradeFromMemo / upgradeToTentativeConcept
//
// 文件系统安全协议 (§6.1/6.3 改进)：
//   调用方（orchestrator）必须遵循 temp file 两阶段提交：
//     1. 写内容到 workspace/notes/.tmp_{uuid}.md
//     2. 调用 createNote() 写入数据库（使用最终 filePath，非 .tmp）
//     3. 数据库提交成功后 → fs.renameSync(.tmp → 最终路径)
//     4. 数据库回滚 → 删除 .tmp 文件
//   下次启动时清理残留 .tmp_* 文件（由 orchestrator 负责）。

import type Database from 'better-sqlite3';
import type { NoteId, PaperId, ConceptId, MemoId } from '../../types/common';
import type { ResearchNote } from '../../types/note';
import type { TextChunk } from '../../types/chunk';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';
import { insertChunksBatch, deleteChunksByPrefix } from './chunks';

/** 生成笔记文件的临时文件名前缀 */
export const NOTE_TEMP_PREFIX = '.tmp_';

/** 检查文件名是否为临时文件（用于启动时清理） */
export function isTempNoteFile(fileName: string): boolean {
  return fileName.startsWith(NOTE_TEMP_PREFIX);
}

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
        tags, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.id,
      note.filePath,
      note.title,
      JSON.stringify(note.linkedPaperIds),
      JSON.stringify(note.linkedConceptIds),
      JSON.stringify(note.tags),
      timestamp,
      timestamp,
    );

    if (chunks.length > 0) {
      insertChunksBatch(db, chunks, embeddings);
    }
  });
}

// ─── §6.2 onNoteFileChanged ───

export function onNoteFileChanged(
  db: Database.Database,
  noteId: NoteId,
  frontmatter: {
    title: string;
    linkedPaperIds: PaperId[];
    linkedConceptIds: ConceptId[];
    tags: string[];
  },
  newChunks: TextChunk[],
  newEmbeddings: (Float32Array | null)[],
): void {
  const timestamp = now();

  writeTransaction(db, () => {
    // 更新 research_notes 元数据
    db.prepare(`
      UPDATE research_notes
      SET title = ?, linked_paper_ids = ?, linked_concept_ids = ?,
          tags = ?, updated_at = ?
      WHERE id = ?
    `).run(
      frontmatter.title,
      JSON.stringify(frontmatter.linkedPaperIds),
      JSON.stringify(frontmatter.linkedConceptIds),
      JSON.stringify(frontmatter.tags),
      timestamp,
      noteId,
    );

    // 删除旧 chunk + vec
    deleteChunksByPrefix(db, `note__${noteId}__`);

    // 写入新 chunk + vec
    if (newChunks.length > 0) {
      insertChunksBatch(db, newChunks, newEmbeddings);
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
// TODO: Markdown 文件读取由调用方（orchestrator）完成

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

export function getNoteByFilePath(
  db: Database.Database,
  filePath: string,
): ResearchNote | null {
  const row = db
    .prepare('SELECT * FROM research_notes WHERE file_path = ?')
    .get(filePath) as Record<string, unknown> | undefined;
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
