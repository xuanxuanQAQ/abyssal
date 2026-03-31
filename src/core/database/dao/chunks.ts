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
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';
import { embeddingToBuffer, validateAndNormalize } from '../vector-ops';
import type { Logger } from '../../infra/logger';

/**
 * 检查 chunks_vec 虚拟表是否存在。
 * skipVecExtension 或 sqlite-vec 未加载时，chunks_vec 不存在。
 * 缓存结果避免每次查询 sqlite_master。
 */
const vecTableCache = new WeakMap<Database.Database, boolean>();
export function hasVecTable(db: Database.Database): boolean {
  let result = vecTableCache.get(db);
  if (result === undefined) {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks_vec'",
    ).get();
    result = row !== undefined;
    vecTableCache.set(db, result);
  }
  return result;
}

// ─── 内部：插入 chunks 文本行（含幂等检查） ───

/**
 * §6.1 幂等写入：检查 chunk_id 是否已存在。
 * 已存在则返回现有 rowid（跳过 INSERT），不存在则执行 INSERT。
 */
function runInsertChunkText(
  db: Database.Database,
  chunk: TextChunk,
): { rowid: number; inserted: boolean } {
  // 幂等检查——chunk_id UNIQUE 约束的应用层前置
  const existing = db.prepare(
    'SELECT rowid FROM chunks WHERE chunk_id = ?',
  ).get(chunk.chunkId) as { rowid: number } | undefined;

  if (existing) {
    return { rowid: existing.rowid, inserted: false };
  }

  // Fix #3: 使用 RETURNING rowid 替代 lastInsertRowid()，
  // 切断与连接级全局状态的耦合——语句级原子性寻址。
  const row = db.prepare(`
    INSERT INTO chunks (
      chunk_id, paper_id, section_label, section_title, section_type,
      page_start, page_end, text, token_count, source,
      position_ratio, parent_chunk_id, chunk_index,
      context_before, context_after, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET created_at = created_at
    RETURNING rowid
  `).get(
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
    chunk.createdAt ?? now(),
  ) as { rowid: number };
  return { rowid: row.rowid, inserted: true };
}

/**
 * §2.7 + §1.2: 验证归一化 → Buffer 转换 → 写入 chunks_vec
 */
function runInsertVec(
  db: Database.Database,
  rowid: number,
  embedding: Float32Array,
  logger?: Logger,
  textHint?: string,
): void {
  if (!hasVecTable(db)) return; // sqlite-vec 未加载时静默跳过
  const buf = embeddingToBuffer(validateAndNormalize(embedding, logger, textHint));
  db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)').run(
    rowid,
    buf,
  );
}

// ─── Phase 1：仅写入 chunks 文本（主线程调用，轻量） ───

/** 写入单条 chunk 文本行，返回 rowid。不写向量。幂等：已存在则跳过。 */
export function insertChunkTextOnly(
  db: Database.Database,
  chunk: TextChunk,
): number {
  return runInsertChunkText(db, chunk).rowid;
}

/** 批量写入 chunk 文本行，返回 rowid[]。不写向量。幂等：已存在则跳过。 */
export function insertChunksTextOnlyBatch(
  db: Database.Database,
  chunks: TextChunk[],
): number[] {
  return writeTransaction(db, () => {
    return chunks.map((chunk) => runInsertChunkText(db, chunk).rowid);
  });
}

// ─── Phase 2：仅写入 chunks_vec 向量（Worker Thread 调用） ───

/**
 * 批量写入嵌入向量。rowids 必须与 embeddings 一一对应。
 * 设计用于在 Worker Thread 的独立连接上调用——通过 busy_timeout 与主线程协调。
 * §2.7: 每个向量在写入前验证归一化。
 */
export function insertChunkVectors(
  db: Database.Database,
  rowids: number[],
  embeddings: Float32Array[],
  logger?: Logger,
): void {
  const stmt = db.prepare(
    'INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)',
  );
  writeTransaction(db, () => {
    for (let i = 0; i < rowids.length; i++) {
      const buf = embeddingToBuffer(validateAndNormalize(embeddings[i]!, logger));
      stmt.run(rowids[i], buf);
    }
  });
}

// ─── 便捷：单条 chunk + 向量一次写入（小数据量 / memo / note 场景） ───

export function insertChunk(
  db: Database.Database,
  chunk: TextChunk,
  embedding: Float32Array | null,
  logger?: Logger,
): number {
  const { rowid, inserted } = runInsertChunkText(db, chunk);
  if (embedding) {
    if (inserted) {
      // 新 chunk：直接写入向量
      runInsertVec(db, rowid, embedding, logger, chunk.text.slice(0, 100));
    } else {
      // 已存在 chunk：更新向量（DELETE + INSERT，vec0 不支持 UPDATE）
      if (hasVecTable(db)) {
        db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(rowid);
      }
      runInsertVec(db, rowid, embedding, logger, chunk.text.slice(0, 100));
    }
  }
  return rowid;
}

// ─── 便捷：批量 chunk + 向量一次写入 ───

export function insertChunksBatch(
  db: Database.Database,
  chunks: TextChunk[],
  embeddings: (Float32Array | null)[],
  logger?: Logger,
): number[] {
  return writeTransaction(db, () => {
    const rowids: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const { rowid, inserted } = runInsertChunkText(db, chunks[i]!);
      rowids.push(rowid);
      const embedding = embeddings[i];
      if (embedding) {
        if (!inserted && hasVecTable(db)) {
          db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(rowid);
        }
        runInsertVec(db, rowid, embedding, logger, chunks[i]!.text.slice(0, 100));
      }
    }
    return rowids;
  });
}

// ─── 按 paper_id 删除 ───

export function deleteChunksByPaper(
  db: Database.Database,
  paperId: PaperId,
): number {
  return writeTransaction(db, () => {
    const rows = db
      .prepare('SELECT rowid FROM chunks WHERE paper_id = ?')
      .all(paperId) as { rowid: number }[];

    if (rows.length === 0) return 0;

    const rowids = rows.map((r) => r.rowid);
    const placeholders = rowids.map(() => '?').join(', ');

    if (hasVecTable(db)) {
      db.prepare(`DELETE FROM chunks_vec WHERE rowid IN (${placeholders})`).run(
        ...rowids,
      );
    }
    return db.prepare('DELETE FROM chunks WHERE paper_id = ?').run(paperId)
      .changes;
  });
}

// ─── 按 chunk_id 前缀删除（用于 memo/note 的 chunk 清理） ───

export function deleteChunksByPrefix(
  db: Database.Database,
  prefix: string,
): number {
  // Fix: 转义 LIKE 特殊字符 % 和 _
  const escapedPrefix = prefix.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return writeTransaction(db, () => {
    const rows = db
      .prepare("SELECT rowid FROM chunks WHERE chunk_id LIKE ? || '%' ESCAPE '\\'")
      .all(escapedPrefix) as { rowid: number }[];

    if (rows.length === 0) return 0;

    const rowids = rows.map((r) => r.rowid);
    const placeholders = rowids.map(() => '?').join(', ');

    if (hasVecTable(db)) {
      db.prepare(`DELETE FROM chunks_vec WHERE rowid IN (${placeholders})`).run(
        ...rowids,
      );
    }
    db.prepare("DELETE FROM chunks WHERE chunk_id LIKE ? || '%' ESCAPE '\\'").run(escapedPrefix);
    return rows.length;
  });
}

// ─── 按 chunk_id 精确删除 ───

export function deleteChunkById(
  db: Database.Database,
  chunkId: ChunkId,
): number {
  return writeTransaction(db, () => {
    const row = db
      .prepare('SELECT rowid FROM chunks WHERE chunk_id = ?')
      .get(chunkId) as { rowid: number } | undefined;
    if (!row) return 0;

    if (hasVecTable(db)) {
      db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(row.rowid);
    }
    return db.prepare('DELETE FROM chunks WHERE chunk_id = ?').run(chunkId)
      .changes;
  });

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

/**
 * 批量查询已存在的 chunk_id 集合（Fix #13: 替代逐条 SELECT）。
 * BATCH_SIZE=500 时占位符数在 SQLite 默认 SQLITE_MAX_VARIABLE_NUMBER=999 以内。
 */
export function getExistingChunkIds(
  db: Database.Database,
  chunkIds: string[],
): Set<string> {
  if (chunkIds.length === 0) return new Set();
  const placeholders = chunkIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT chunk_id FROM chunks WHERE chunk_id IN (${placeholders})`)
    .all(...chunkIds) as { chunk_id: string }[];
  return new Set(rows.map((r) => r.chunk_id));
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
