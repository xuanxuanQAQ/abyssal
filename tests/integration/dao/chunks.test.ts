import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import {
  insertChunkTextOnly,
  insertChunksTextOnlyBatch,
  insertChunk,
  getChunksByPaper,
  deleteChunksByPaper,
  deleteChunksByPrefix,
  getChunkByChunkId,
} from '@core/database/dao/chunks';
import type { TextChunk } from '@core/types/chunk';
import { asChunkId, asPaperId } from '@core/types/common';
import type { PaperId } from '@core/types/common';

// ── helpers ──

const PAPER_ID = asPaperId('aabbccddeeff');
const PAPER_ID_2 = asPaperId('112233445566');

function insertPaper(db: Database.Database, id: PaperId): void {
  db.prepare(
    `INSERT INTO papers (id, title, year, discovered_at, updated_at)
     VALUES (?, 'Test Paper', 2024, datetime('now'), datetime('now'))`,
  ).run(id);
}

function makeChunk(overrides: Partial<TextChunk> & { chunkId: TextChunk['chunkId'] }): TextChunk {
  return {
    paperId: PAPER_ID,
    sectionLabel: null,
    sectionTitle: null,
    sectionType: null,
    pageStart: null,
    pageEnd: null,
    text: 'default chunk text',
    tokenCount: 10,
    source: 'paper',
    positionRatio: null,
    parentChunkId: null,
    chunkIndex: null,
    contextBefore: null,
    contextAfter: null,
    ...overrides,
  };
}

/** Create a normalized Float32Array of the test embedding dimension (4). */
function makeEmbedding(seed: number): Float32Array {
  const raw = new Float32Array([seed, seed + 1, seed + 2, seed + 3]);
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return raw.map((v) => v / norm);
}

describe('chunks DAO', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
    insertPaper(db, PAPER_ID);
  });

  afterEach(() => {
    db.close();
  });

  // ── insertChunkTextOnly ──

  it('insertChunkTextOnly returns rowid', () => {
    const chunk = makeChunk({ chunkId: asChunkId('chunk_001') });
    const rowid = insertChunkTextOnly(db, chunk);
    expect(rowid).toBeGreaterThan(0);

    const stored = getChunkByChunkId(db, asChunkId('chunk_001'));
    expect(stored).not.toBeNull();
    expect(stored!.text).toBe('default chunk text');
  });

  it('insertChunkTextOnly is idempotent on same chunk_id', () => {
    const chunk = makeChunk({ chunkId: asChunkId('chunk_idem') });
    const rowid1 = insertChunkTextOnly(db, chunk);
    const rowid2 = insertChunkTextOnly(db, chunk);
    expect(rowid1).toBe(rowid2);

    // Only one row exists
    const rows = db
      .prepare("SELECT COUNT(*) as cnt FROM chunks WHERE chunk_id = 'chunk_idem'")
      .get() as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  // ── insertChunksTextOnlyBatch ──

  it('insertChunksTextOnlyBatch returns correct rowids', () => {
    const chunks = [
      makeChunk({ chunkId: asChunkId('batch_1'), chunkIndex: 0 }),
      makeChunk({ chunkId: asChunkId('batch_2'), chunkIndex: 1 }),
      makeChunk({ chunkId: asChunkId('batch_3'), chunkIndex: 2 }),
    ];
    const rowids = insertChunksTextOnlyBatch(db, chunks);
    expect(rowids).toHaveLength(3);
    expect(new Set(rowids).size).toBe(3); // all distinct

    for (const rid of rowids) {
      expect(rid).toBeGreaterThan(0);
    }
  });

  it('insertChunksTextOnlyBatch is idempotent for duplicates', () => {
    const chunk = makeChunk({ chunkId: asChunkId('dup_batch') });
    const rowids1 = insertChunksTextOnlyBatch(db, [chunk]);
    const rowids2 = insertChunksTextOnlyBatch(db, [chunk]);
    expect(rowids1[0]).toBe(rowids2[0]);
  });

  // ── insertChunk with embedding (vector update via DELETE+INSERT) ──

  it('insertChunk with existing chunk_id updates vector (DELETE+INSERT)', () => {
    const chunk = makeChunk({ chunkId: asChunkId('vec_update') });
    const emb1 = makeEmbedding(1);
    const rowid1 = insertChunk(db, chunk, emb1);

    // Insert again with different embedding — should reuse same rowid
    const emb2 = makeEmbedding(5);
    const rowid2 = insertChunk(db, chunk, emb2);
    expect(rowid2).toBe(rowid1);

    // The chunk text row still exists
    const stored = getChunkByChunkId(db, asChunkId('vec_update'));
    expect(stored).not.toBeNull();

    // Vector table assertions — only when sqlite-vec is loaded
    // skipVecExtension=true in test env means chunks_vec doesn't exist
    const hasVec = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks_vec'",
    ).get();
    if (hasVec) {
      const vecCount = db
        .prepare('SELECT COUNT(*) as cnt FROM chunks_vec WHERE rowid = ?')
        .get(rowid1) as { cnt: number };
      expect(vecCount.cnt).toBe(1);
    }
  });

  it('insertChunk with null embedding writes text only', () => {
    const chunk = makeChunk({ chunkId: asChunkId('no_vec') });
    const rowid = insertChunk(db, chunk, null);
    expect(rowid).toBeGreaterThan(0);

    // Without sqlite-vec, just verify text was written
    const stored = getChunkByChunkId(db, asChunkId('no_vec'));
    expect(stored).not.toBeNull();
  });

  // ── deleteChunksByPaper ──

  it('deleteChunksByPaper removes all chunks for paper', () => {
    insertPaper(db, PAPER_ID_2);

    const chunksP1 = [
      makeChunk({ chunkId: asChunkId('p1_c1'), paperId: PAPER_ID }),
      makeChunk({ chunkId: asChunkId('p1_c2'), paperId: PAPER_ID }),
    ];
    const chunksP2 = [
      makeChunk({ chunkId: asChunkId('p2_c1'), paperId: PAPER_ID_2 }),
    ];
    insertChunksTextOnlyBatch(db, [...chunksP1, ...chunksP2]);

    const deleted = deleteChunksByPaper(db, PAPER_ID);
    expect(deleted).toBe(2);

    expect(getChunksByPaper(db, PAPER_ID)).toHaveLength(0);
    expect(getChunksByPaper(db, PAPER_ID_2)).toHaveLength(1);
  });

  it('deleteChunksByPaper returns 0 for non-existent paper', () => {
    const deleted = deleteChunksByPaper(db, asPaperId('000000000000'));
    expect(deleted).toBe(0);
  });

  // ── deleteChunksByPrefix ──

  it('deleteChunksByPrefix removes matching chunks', () => {
    const chunks = [
      makeChunk({ chunkId: asChunkId('memo__42'), paperId: null, source: 'memo' }),
      makeChunk({ chunkId: asChunkId('memo__43'), paperId: null, source: 'memo' }),
      makeChunk({ chunkId: asChunkId('note__1'), paperId: null, source: 'note' }),
    ];
    insertChunksTextOnlyBatch(db, chunks);

    const deleted = deleteChunksByPrefix(db, 'memo__4');
    expect(deleted).toBe(2);

    expect(getChunkByChunkId(db, asChunkId('note__1'))).not.toBeNull();
  });

  it('deleteChunksByPrefix handles special LIKE chars (% and _)', () => {
    const chunks = [
      makeChunk({ chunkId: asChunkId('test_%_special'), paperId: null, source: 'memo' }),
      makeChunk({ chunkId: asChunkId('test_other'), paperId: null, source: 'memo' }),
    ];
    insertChunksTextOnlyBatch(db, chunks);

    // Prefix "test_%" should only match chunk_id starting with literal "test_%"
    const deleted = deleteChunksByPrefix(db, 'test_%');
    expect(deleted).toBe(1);

    // "test_other" should still exist
    expect(getChunkByChunkId(db, asChunkId('test_other'))).not.toBeNull();
  });

  it('deleteChunksByPrefix with underscore prefix', () => {
    const chunks = [
      makeChunk({ chunkId: asChunkId('a_b_c'), paperId: null, source: 'memo' }),
      makeChunk({ chunkId: asChunkId('a_b_d'), paperId: null, source: 'memo' }),
      makeChunk({ chunkId: asChunkId('axbxc'), paperId: null, source: 'memo' }),
    ];
    insertChunksTextOnlyBatch(db, chunks);

    // "a_b" with escaped underscore should match "a_b_c" and "a_b_d"
    // but NOT "axbxc" (since _ is a single-char wildcard in LIKE, but we escape it)
    const deleted = deleteChunksByPrefix(db, 'a_b');
    expect(deleted).toBe(2);
    expect(getChunkByChunkId(db, asChunkId('axbxc'))).not.toBeNull();
  });

  // ── getChunksByPaper ──

  it('getChunksByPaper returns in chunk_index order', () => {
    const chunks = [
      makeChunk({ chunkId: asChunkId('ord_3'), chunkIndex: 3, text: 'third' }),
      makeChunk({ chunkId: asChunkId('ord_1'), chunkIndex: 1, text: 'first' }),
      makeChunk({ chunkId: asChunkId('ord_2'), chunkIndex: 2, text: 'second' }),
    ];
    insertChunksTextOnlyBatch(db, chunks);

    const result = getChunksByPaper(db, PAPER_ID);
    expect(result).toHaveLength(3);
    expect(result[0]!.text).toBe('first');
    expect(result[1]!.text).toBe('second');
    expect(result[2]!.text).toBe('third');
  });

  it('getChunksByPaper places null chunk_index last', () => {
    const chunks = [
      makeChunk({ chunkId: asChunkId('null_idx'), chunkIndex: null, text: 'no index' }),
      makeChunk({ chunkId: asChunkId('idx_0'), chunkIndex: 0, text: 'indexed' }),
    ];
    insertChunksTextOnlyBatch(db, chunks);

    const result = getChunksByPaper(db, PAPER_ID);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('indexed');
    expect(result[1]!.text).toBe('no index');
  });

  it('getChunksByPaper returns empty array for unknown paper', () => {
    const result = getChunksByPaper(db, asPaperId('000000000000'));
    expect(result).toEqual([]);
  });
});
