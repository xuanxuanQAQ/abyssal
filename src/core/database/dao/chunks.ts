// ═══ 文本块 + 向量索引 CRUD ═══
// §2.2.8: chunks 与 chunks_vec 通过 rowid 一一对应
//
// 线程模型 (§1.3 改进)：
//   主线程：insertChunkTextOnly / insertChunksTextOnlyBatch → 返回 rowid[]
//   Worker：insertChunkVectors → 用 rowid[] + embeddings 直接写 chunks_vec
//   便捷：insertChunk / insertChunksBatch → 单线程场景或小数据量时仍可用

import type Database from 'better-sqlite3';
import type { ChunkId, PaperId } from '../../types/common';
import type { TextChunk, ChunkSource } from '../../types/chunk';
import { fromRow } from '../row-mapper';

// ─── 内部：插入 chunks 文本行 ───

function runInsertChunkText(
  db: Database.Database,
  chunk: TextChunk,
): number {
  const result = db.prepare(`
    INSERT INTO chunks (
      chunk_id, paper_id, section_label, section_title, section_type,
      page_start, page_end, text, token_count, source,
      position_ratio, parent_chunk_id, chunk_index,
      context_before, context_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chunk.chunkId,
    chunk.paperId,
    chunk.sectionLabel,
    chunk.sectionTitle,
    chunk.sectionType,
    chunk.pageStart,
    chunk.pageEnd,
    chunk.text,
    chunk.tokenCount,
    chunk.source,
    chunk.positionRatio,
    chunk.parentChunkId,
    chunk.chunkIndex,
    chunk.contextBefore,
    chunk.contextAfter,
  );
  return Number(result.lastInsertRowid);
}

function runInsertVec(
  db: Database.Database,
  rowid: number,
  embedding: Float32Array,
): void {
  db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)').run(
    rowid,
    Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength),
  );
}

// ─── Phase 1：仅写入 chunks 文本（主线程调用，轻量） ───

/** 写入单条 chunk 文本行，返回 rowid。不写向量。 */
export function insertChunkTextOnly(
  db: Database.Database,
  chunk: TextChunk,
): number {
  return runInsertChunkText(db, chunk);
}

/** 批量写入 chunk 文本行，返回 rowid[]。不写向量。 */
export function insertChunksTextOnlyBatch(
  db: Database.Database,
  chunks: TextChunk[],
): number[] {
  const batchFn = db.transaction(() => {
    return chunks.map((chunk) => runInsertChunkText(db, chunk));
  });
  return batchFn();
}

// ─── Phase 2：仅写入 chunks_vec 向量（Worker Thread 调用） ───

/**
 * 批量写入嵌入向量。rowids 必须与 embeddings 一一对应。
 * 设计用于在 Worker Thread 的独立连接上调用——通过 busy_timeout 与主线程协调。
 */
export function insertChunkVectors(
  db: Database.Database,
  rowids: number[],
  embeddings: Float32Array[],
): void {
  const stmt = db.prepare(
    'INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)',
  );
  const batchFn = db.transaction(() => {
    for (let i = 0; i < rowids.length; i++) {
      stmt.run(
        rowids[i],
        Buffer.from(
          embeddings[i]!.buffer,
          embeddings[i]!.byteOffset,
          embeddings[i]!.byteLength,
        ),
      );
    }
  });
  batchFn();
}

// ─── 便捷：单条 chunk + 向量一次写入（小数据量 / memo / note 场景） ───

export function insertChunk(
  db: Database.Database,
  chunk: TextChunk,
  embedding: Float32Array | null,
): number {
  const rowid = runInsertChunkText(db, chunk);
  if (embedding) {
    runInsertVec(db, rowid, embedding);
  }
  return rowid;
}

// ─── 便捷：批量 chunk + 向量一次写入 ───

export function insertChunksBatch(
  db: Database.Database,
  chunks: TextChunk[],
  embeddings: (Float32Array | null)[],
): number[] {
  const batchFn = db.transaction(() => {
    const rowids: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const rowid = runInsertChunkText(db, chunks[i]!);
      rowids.push(rowid);
      const embedding = embeddings[i];
      if (embedding) {
        runInsertVec(db, rowid, embedding);
      }
    }
    return rowids;
  });
  return batchFn();
}

// ─── 按 paper_id 删除 ───

export function deleteChunksByPaper(
  db: Database.Database,
  paperId: PaperId,
): number {
  const deleteFn = db.transaction(() => {
    const rows = db
      .prepare('SELECT rowid FROM chunks WHERE paper_id = ?')
      .all(paperId) as { rowid: number }[];

    if (rows.length === 0) return 0;

    const rowids = rows.map((r) => r.rowid);
    const placeholders = rowids.map(() => '?').join(', ');

    db.prepare(`DELETE FROM chunks_vec WHERE rowid IN (${placeholders})`).run(
      ...rowids,
    );
    return db.prepare('DELETE FROM chunks WHERE paper_id = ?').run(paperId)
      .changes;
  });

  return deleteFn();
}

// ─── 按 chunk_id 前缀删除（用于 memo/note 的 chunk 清理） ───

export function deleteChunksByPrefix(
  db: Database.Database,
  prefix: string,
): number {
  // Fix: 转义 LIKE 特殊字符 % 和 _
  const escapedPrefix = prefix.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const deleteFn = db.transaction(() => {
    const rows = db
      .prepare("SELECT rowid FROM chunks WHERE chunk_id LIKE ? || '%' ESCAPE '\\'")
      .all(escapedPrefix) as { rowid: number }[];

    if (rows.length === 0) return 0;

    const rowids = rows.map((r) => r.rowid);
    const placeholders = rowids.map(() => '?').join(', ');

    db.prepare(`DELETE FROM chunks_vec WHERE rowid IN (${placeholders})`).run(
      ...rowids,
    );
    db.prepare("DELETE FROM chunks WHERE chunk_id LIKE ? || '%' ESCAPE '\\'").run(escapedPrefix);
    return rows.length;
  });

  return deleteFn();
}

// ─── 按 chunk_id 精确删除 ───

export function deleteChunkById(
  db: Database.Database,
  chunkId: ChunkId,
): number {
  const deleteFn = db.transaction(() => {
    const row = db
      .prepare('SELECT rowid FROM chunks WHERE chunk_id = ?')
      .get(chunkId) as { rowid: number } | undefined;
    if (!row) return 0;

    db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(row.rowid);
    return db.prepare('DELETE FROM chunks WHERE chunk_id = ?').run(chunkId)
      .changes;
  });

  return deleteFn();
}

// ─── 查询 ───

export function getChunksByPaper(
  db: Database.Database,
  paperId: PaperId,
): TextChunk[] {
  const rows = db
    .prepare(
      'SELECT * FROM chunks WHERE paper_id = ? ORDER BY chunk_index NULLS LAST',
    )
    .all(paperId) as Record<string, unknown>[];
  return rows.map((r) => fromRow<TextChunk>(r));
}

export function getChunkByChunkId(
  db: Database.Database,
  chunkId: ChunkId,
): TextChunk | null {
  const row = db
    .prepare('SELECT * FROM chunks WHERE chunk_id = ?')
    .get(chunkId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return fromRow<TextChunk>(row);
}

export function getChunkRowid(
  db: Database.Database,
  chunkId: ChunkId,
): number | null {
  const row = db
    .prepare('SELECT rowid FROM chunks WHERE chunk_id = ?')
    .get(chunkId) as { rowid: number } | undefined;
  return row?.rowid ?? null;
}
