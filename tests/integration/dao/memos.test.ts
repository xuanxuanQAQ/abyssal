import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import {
  addMemo,
  updateMemo,
  getMemosByEntity,
  getMemo,
  deleteMemo,
} from '@core/database/dao/memos';
import { getChunkByChunkId } from '@core/database/dao/chunks';
import { asPaperId, asConceptId, asChunkId, asMemoId } from '@core/types/common';
import type { PaperId, ConceptId, MemoId } from '@core/types/common';
import type { ResearchMemo } from '@core/types/memo';

// ── helpers ──

const PAPER_ID_1 = asPaperId('aabbccddeeff');
const PAPER_ID_2 = asPaperId('112233445566');
const CONCEPT_ID_1 = asConceptId('deep_learning');
const CONCEPT_ID_2 = asConceptId('attention_mech');

function insertPaper(db: Database.Database, id: PaperId): void {
  db.prepare(
    `INSERT INTO papers (id, title, year, discovered_at, updated_at)
     VALUES (?, 'Test Paper', 2024, datetime('now'), datetime('now'))`,
  ).run(id);
}

function insertConcept(db: Database.Database, id: ConceptId): void {
  db.prepare(
    `INSERT INTO concepts (id, name_zh, name_en, layer, definition, created_at, updated_at)
     VALUES (?, 'zh_name', 'en_name', 'core', 'A definition', datetime('now'), datetime('now'))`,
  ).run(id);
}

function baseMemo(overrides?: Partial<Omit<ResearchMemo, 'id' | 'createdAt' | 'updatedAt'>>) {
  return {
    text: 'A research memo about transformers.',
    paperIds: [] as PaperId[],
    conceptIds: [] as ConceptId[],
    annotationId: null,
    outlineId: null,
    linkedNoteIds: [],
    tags: ['tag1'],
    indexed: false,
    ...overrides,
  };
}

describe('memos DAO', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
    insertPaper(db, PAPER_ID_1);
    insertPaper(db, PAPER_ID_2);
    insertConcept(db, CONCEPT_ID_1);
    insertConcept(db, CONCEPT_ID_2);
  });

  afterEach(() => {
    db.close();
  });

  // ── addMemo ──

  it('addMemo creates memo + chunk', () => {
    const { memoId, chunkRowid } = addMemo(db, baseMemo(), null);

    expect(memoId).toBeTruthy();
    expect(chunkRowid).toBeGreaterThan(0);

    // Memo exists
    const memo = getMemo(db, memoId);
    expect(memo).not.toBeNull();
    expect(memo!.text).toBe('A research memo about transformers.');
    expect(memo!.tags).toEqual(['tag1']);

    // Chunk exists with memo__<id> chunkId
    const chunkId = asChunkId(`memo__${memoId}`);
    const chunk = getChunkByChunkId(db, chunkId);
    expect(chunk).not.toBeNull();
    expect(chunk!.source).toBe('memo');
    expect(chunk!.text).toBe('A research memo about transformers.');
  });

  it('addMemo with paperIds populates memo_paper_map', () => {
    const { memoId } = addMemo(
      db,
      baseMemo({ paperIds: [PAPER_ID_1, PAPER_ID_2] }),
      null,
    );

    // Check junction table
    const maps = db
      .prepare('SELECT paper_id FROM memo_paper_map WHERE memo_id = ? ORDER BY paper_id')
      .all(Number(memoId)) as { paper_id: string }[];
    expect(maps).toHaveLength(2);
    expect(maps.map((m) => m.paper_id)).toContain(PAPER_ID_1 as string);
    expect(maps.map((m) => m.paper_id)).toContain(PAPER_ID_2 as string);
  });

  it('addMemo with conceptIds populates memo_concept_map', () => {
    const { memoId } = addMemo(
      db,
      baseMemo({ conceptIds: [CONCEPT_ID_1] }),
      null,
    );

    const maps = db
      .prepare('SELECT concept_id FROM memo_concept_map WHERE memo_id = ?')
      .all(Number(memoId)) as { concept_id: string }[];
    expect(maps).toHaveLength(1);
    expect(maps[0]!.concept_id).toBe(CONCEPT_ID_1 as string);
  });

  it('addMemo with embedding sets indexed=1', () => {
    const emb = normalizedVec4(1);
    const { memoId } = addMemo(db, baseMemo(), emb);

    const memo = getMemo(db, memoId);
    expect(memo!.indexed).toBe(true);
  });

  it('addMemo without embedding sets indexed=0', () => {
    const { memoId } = addMemo(db, baseMemo(), null);

    const memo = getMemo(db, memoId);
    expect(memo!.indexed).toBe(false);
  });

  // ── updateMemo ──

  it('updateMemo with text change rebuilds chunk', () => {
    const { memoId } = addMemo(db, baseMemo(), null);

    const changes = updateMemo(db, memoId, { text: 'Updated memo text.' });
    expect(changes).toBe(1);

    const memo = getMemo(db, memoId);
    expect(memo!.text).toBe('Updated memo text.');

    // Chunk should reflect new text
    const chunk = getChunkByChunkId(db, asChunkId(`memo__${memoId}`));
    expect(chunk).not.toBeNull();
    expect(chunk!.text).toBe('Updated memo text.');
  });

  it('updateMemo metadata-only does not rebuild chunk', () => {
    const { memoId } = addMemo(db, baseMemo({ text: 'Original text' }), null);

    // Get chunk created_at before update
    const chunkBefore = getChunkByChunkId(db, asChunkId(`memo__${memoId}`));
    expect(chunkBefore).not.toBeNull();

    // Update only tags (no text change)
    updateMemo(db, memoId, { tags: ['new-tag'] });

    // Chunk should still have original text (not rebuilt)
    const chunkAfter = getChunkByChunkId(db, asChunkId(`memo__${memoId}`));
    expect(chunkAfter).not.toBeNull();
    expect(chunkAfter!.text).toBe('Original text');

    // Memo tags updated
    const memo = getMemo(db, memoId);
    expect(memo!.tags).toEqual(['new-tag']);
  });

  it('updateMemo with paperIds syncs memo_paper_map', () => {
    const { memoId } = addMemo(
      db,
      baseMemo({ paperIds: [PAPER_ID_1] }),
      null,
    );

    // Change to paper_id_2 only
    updateMemo(db, memoId, { paperIds: [PAPER_ID_2] });

    const maps = db
      .prepare('SELECT paper_id FROM memo_paper_map WHERE memo_id = ?')
      .all(Number(memoId)) as { paper_id: string }[];
    expect(maps).toHaveLength(1);
    expect(maps[0]!.paper_id).toBe(PAPER_ID_2 as string);
  });

  // ── getMemosByEntity ──

  it('getMemosByEntity("paper", paperId) returns correct memos', () => {
    addMemo(db, baseMemo({ paperIds: [PAPER_ID_1], text: 'Memo for P1' }), null);
    addMemo(db, baseMemo({ paperIds: [PAPER_ID_2], text: 'Memo for P2' }), null);
    addMemo(db, baseMemo({ paperIds: [PAPER_ID_1, PAPER_ID_2], text: 'Memo for both' }), null);

    const memosP1 = getMemosByEntity(db, 'paper', PAPER_ID_1 as string);
    expect(memosP1).toHaveLength(2);
    const texts = memosP1.map((m) => m.text);
    expect(texts).toContain('Memo for P1');
    expect(texts).toContain('Memo for both');
  });

  it('getMemosByEntity("concept", conceptId) returns correct memos', () => {
    addMemo(db, baseMemo({ conceptIds: [CONCEPT_ID_1], text: 'Concept memo' }), null);
    addMemo(db, baseMemo({ text: 'Unrelated memo' }), null);

    const memos = getMemosByEntity(db, 'concept', CONCEPT_ID_1 as string);
    expect(memos).toHaveLength(1);
    expect(memos[0]!.text).toBe('Concept memo');
  });

  it('getMemosByEntity returns empty array for no matches', () => {
    const memos = getMemosByEntity(db, 'paper', 'nonexistent');
    expect(memos).toEqual([]);
  });

  // ── deleteMemo ──

  it('deleteMemo cascades to chunks', () => {
    const { memoId } = addMemo(db, baseMemo(), null);
    const chunkId = asChunkId(`memo__${memoId}`);

    // Verify chunk exists
    expect(getChunkByChunkId(db, chunkId)).not.toBeNull();

    const deleted = deleteMemo(db, memoId);
    expect(deleted).toBe(1);

    // Memo gone
    expect(getMemo(db, memoId)).toBeNull();

    // Chunk gone
    expect(getChunkByChunkId(db, chunkId)).toBeNull();
  });

  it('deleteMemo cascades to junction tables', () => {
    const { memoId } = addMemo(
      db,
      baseMemo({ paperIds: [PAPER_ID_1], conceptIds: [CONCEPT_ID_1] }),
      null,
    );

    deleteMemo(db, memoId);

    const paperMaps = db
      .prepare('SELECT * FROM memo_paper_map WHERE memo_id = ?')
      .all(Number(memoId));
    const conceptMaps = db
      .prepare('SELECT * FROM memo_concept_map WHERE memo_id = ?')
      .all(Number(memoId));
    expect(paperMaps).toHaveLength(0);
    expect(conceptMaps).toHaveLength(0);
  });

  it('deleteMemo returns 0 for non-existent memo', () => {
    const deleted = deleteMemo(db, asMemoId('99999'));
    expect(deleted).toBe(0);
  });
});

// ── utility ──

function normalizedVec4(seed: number): Float32Array {
  const raw = new Float32Array([seed, seed + 1, seed + 2, seed + 3]);
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return raw.map((v) => v / norm);
}
