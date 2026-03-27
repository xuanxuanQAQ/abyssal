import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import {
  mapPaperConcept,
  mapPaperConceptBatch,
  getMappingsByPaper,
  getMappingsByConcept,
  getMapping,
  getConceptMatrix,
  deleteMapping,
} from '@core/database/dao/mappings';
import type { ConceptMapping, BilingualEvidence } from '@core/types/mapping';
import { asPaperId, asConceptId } from '@core/types/common';
import type { PaperId, ConceptId } from '@core/types/common';

// ── helpers ──

const PAPER_1 = asPaperId('aabbccddeeff');
const PAPER_2 = asPaperId('112233445566');
const CONCEPT_1 = asConceptId('deep_learning');
const CONCEPT_2 = asConceptId('attention_mech');
const CONCEPT_3 = asConceptId('transformer');

function insertPaper(db: Database.Database, id: PaperId): void {
  db.prepare(
    `INSERT INTO papers (id, title, year, discovered_at, updated_at)
     VALUES (?, 'Test Paper', 2024, datetime('now'), datetime('now'))`,
  ).run(id);
}

function insertConcept(db: Database.Database, id: ConceptId, deprecated = false): void {
  db.prepare(
    `INSERT INTO concepts (id, name_zh, name_en, layer, definition, deprecated, created_at, updated_at)
     VALUES (?, 'zh', 'en', 'core', 'def', ?, datetime('now'), datetime('now'))`,
  ).run(id, deprecated ? 1 : 0);
}

function makeEvidence(text = 'Evidence text'): BilingualEvidence {
  return {
    en: text,
    original: text,
    originalLang: 'en',
    chunkId: null,
    page: null,
    annotationId: null,
  };
}

function makeMapping(overrides?: Partial<ConceptMapping>): ConceptMapping {
  return {
    paperId: PAPER_1,
    conceptId: CONCEPT_1,
    relation: 'supports',
    confidence: 0.85,
    evidence: makeEvidence(),
    annotationId: null,
    reviewed: false,
    reviewedAt: null,
    ...overrides,
  };
}

describe('mappings DAO', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
    insertPaper(db, PAPER_1);
    insertPaper(db, PAPER_2);
    insertConcept(db, CONCEPT_1);
    insertConcept(db, CONCEPT_2);
    insertConcept(db, CONCEPT_3);
  });

  afterEach(() => {
    db.close();
  });

  // ── mapPaperConcept — basic INSERT ──

  it('mapPaperConcept creates a new mapping', () => {
    const mapping = makeMapping();
    mapPaperConcept(db, mapping);

    const stored = getMapping(db, PAPER_1, CONCEPT_1);
    expect(stored).not.toBeNull();
    expect(stored!.relation).toBe('supports');
    expect(stored!.confidence).toBeCloseTo(0.85);
    expect(stored!.reviewed).toBe(false);
    expect(stored!.evidence.en).toBe('Evidence text');
  });

  // ── mapPaperConcept — UPSERT ──

  it('mapPaperConcept UPSERT updates existing mapping', () => {
    mapPaperConcept(db, makeMapping({ confidence: 0.80 }));

    // Upsert with new values
    mapPaperConcept(db, makeMapping({
      confidence: 0.95,
      relation: 'extends',
      evidence: makeEvidence('Updated evidence'),
    }));

    const stored = getMapping(db, PAPER_1, CONCEPT_1);
    expect(stored!.relation).toBe('extends');
    expect(stored!.confidence).toBeCloseTo(0.95);
    expect(stored!.evidence.en).toBe('Updated evidence');
  });

  // ── UPSERT preserves reviewed=true when confidence change < 0.05 ──

  it('UPSERT preserves reviewed=true when confidence change < 0.05', () => {
    // Insert with reviewed=true
    mapPaperConcept(db, makeMapping({
      confidence: 0.80,
      reviewed: true,
      reviewedAt: '2025-01-01T00:00:00Z',
    }));

    // Verify reviewed is true
    const before = getMapping(db, PAPER_1, CONCEPT_1);
    expect(before!.reviewed).toBe(true);

    // Upsert with small confidence change (0.03 < 0.05), same relation
    mapPaperConcept(db, makeMapping({
      confidence: 0.83,
      relation: 'supports', // same relation
      reviewed: false, // incoming says false, but CASE logic should preserve true
      reviewedAt: null,
    }));

    const after = getMapping(db, PAPER_1, CONCEPT_1);
    expect(after!.confidence).toBeCloseTo(0.83);
    // reviewed should be preserved (not reset) because delta < 0.05
    expect(after!.reviewed).toBe(true);
  });

  // ── UPSERT resets reviewed when confidence change >= 0.05 ──

  it('UPSERT resets reviewed when confidence change >= 0.05', () => {
    // Insert with reviewed=true
    mapPaperConcept(db, makeMapping({
      confidence: 0.80,
      reviewed: true,
      reviewedAt: '2025-01-01T00:00:00Z',
    }));

    // Upsert with large confidence change (0.20 > 0.05)
    mapPaperConcept(db, makeMapping({
      confidence: 0.60,
      relation: 'supports',
      reviewed: false,
      reviewedAt: null,
    }));

    const after = getMapping(db, PAPER_1, CONCEPT_1);
    expect(after!.confidence).toBeCloseTo(0.60);
    // reviewed should be reset because delta >= 0.05
    expect(after!.reviewed).toBe(false);
  });

  it('UPSERT resets reviewed when relation changes', () => {
    mapPaperConcept(db, makeMapping({
      confidence: 0.80,
      relation: 'supports',
      reviewed: true,
      reviewedAt: '2025-01-01T00:00:00Z',
    }));

    // Same confidence, different relation
    mapPaperConcept(db, makeMapping({
      confidence: 0.80,
      relation: 'challenges',
      reviewed: false,
      reviewedAt: null,
    }));

    const after = getMapping(db, PAPER_1, CONCEPT_1);
    expect(after!.relation).toBe('challenges');
    expect(after!.reviewed).toBe(false);
  });

  // ── mapPaperConceptBatch ──

  it('mapPaperConceptBatch inserts multiple mappings atomically', () => {
    const mappings: ConceptMapping[] = [
      makeMapping({ conceptId: CONCEPT_1, confidence: 0.9 }),
      makeMapping({ conceptId: CONCEPT_2, confidence: 0.7 }),
      makeMapping({ conceptId: CONCEPT_3, confidence: 0.5 }),
    ];
    mapPaperConceptBatch(db, mappings);

    const byPaper = getMappingsByPaper(db, PAPER_1);
    expect(byPaper).toHaveLength(3);
  });

  it('mapPaperConceptBatch with empty array is a no-op', () => {
    mapPaperConceptBatch(db, []);
    const byPaper = getMappingsByPaper(db, PAPER_1);
    expect(byPaper).toHaveLength(0);
  });

  // ── getMappingsByPaper / getMappingsByConcept ──

  it('getMappingsByPaper returns sorted by confidence DESC', () => {
    mapPaperConcept(db, makeMapping({ conceptId: CONCEPT_1, confidence: 0.5 }));
    mapPaperConcept(db, makeMapping({ conceptId: CONCEPT_2, confidence: 0.9 }));
    mapPaperConcept(db, makeMapping({ conceptId: CONCEPT_3, confidence: 0.7 }));

    const mappings = getMappingsByPaper(db, PAPER_1);
    expect(mappings).toHaveLength(3);
    expect(mappings[0]!.confidence).toBeCloseTo(0.9);
    expect(mappings[1]!.confidence).toBeCloseTo(0.7);
    expect(mappings[2]!.confidence).toBeCloseTo(0.5);
  });

  it('getMappingsByConcept returns mappings across papers', () => {
    mapPaperConcept(db, makeMapping({ paperId: PAPER_1, conceptId: CONCEPT_1, confidence: 0.8 }));
    mapPaperConcept(db, makeMapping({ paperId: PAPER_2, conceptId: CONCEPT_1, confidence: 0.6 }));

    const mappings = getMappingsByConcept(db, CONCEPT_1);
    expect(mappings).toHaveLength(2);
    // Sorted by confidence DESC
    expect(mappings[0]!.paperId).toBe(PAPER_1 as string);
    expect(mappings[1]!.paperId).toBe(PAPER_2 as string);
  });

  it('getMappingsByPaper returns empty for unknown paper', () => {
    expect(getMappingsByPaper(db, asPaperId('000000000000'))).toEqual([]);
  });

  it('getMappingsByConcept returns empty for unknown concept', () => {
    expect(getMappingsByConcept(db, asConceptId('nonexistent'))).toEqual([]);
  });

  // ── getConceptMatrix ──

  it('getConceptMatrix returns correct structure', () => {
    mapPaperConcept(db, makeMapping({ paperId: PAPER_1, conceptId: CONCEPT_1, confidence: 0.9, reviewed: true }));
    mapPaperConcept(db, makeMapping({ paperId: PAPER_1, conceptId: CONCEPT_2, confidence: 0.7 }));
    mapPaperConcept(db, makeMapping({ paperId: PAPER_2, conceptId: CONCEPT_1, confidence: 0.6 }));

    const matrix = getConceptMatrix(db);
    expect(matrix).toHaveLength(3);

    // Ordered by paper_id, concept_id
    for (const entry of matrix) {
      expect(entry).toHaveProperty('paperId');
      expect(entry).toHaveProperty('conceptId');
      expect(entry).toHaveProperty('relation');
      expect(entry).toHaveProperty('confidence');
      expect(entry).toHaveProperty('reviewed');
      expect(typeof entry.confidence).toBe('number');
      expect(typeof entry.reviewed).toBe('boolean');
    }
  });

  it('getConceptMatrix excludes deprecated concepts', () => {
    const deprecatedId = asConceptId('old_concept');
    insertConcept(db, deprecatedId, /* deprecated */ true);

    mapPaperConcept(db, makeMapping({ conceptId: CONCEPT_1, confidence: 0.9 }));
    mapPaperConcept(db, makeMapping({ conceptId: deprecatedId, confidence: 0.8 }));

    const matrix = getConceptMatrix(db);
    const conceptIds = matrix.map((e) => e.conceptId);
    expect(conceptIds).toContain(CONCEPT_1 as string);
    expect(conceptIds).not.toContain(deprecatedId as string);
  });

  // ── deleteMapping ──

  it('deleteMapping removes the mapping', () => {
    mapPaperConcept(db, makeMapping());

    const deleted = deleteMapping(db, PAPER_1, CONCEPT_1);
    expect(deleted).toBe(1);

    expect(getMapping(db, PAPER_1, CONCEPT_1)).toBeNull();
  });

  it('deleteMapping returns 0 for non-existent mapping', () => {
    const deleted = deleteMapping(db, PAPER_1, CONCEPT_1);
    expect(deleted).toBe(0);
  });

  it('deleteMapping does not affect other mappings', () => {
    mapPaperConcept(db, makeMapping({ conceptId: CONCEPT_1 }));
    mapPaperConcept(db, makeMapping({ conceptId: CONCEPT_2 }));

    deleteMapping(db, PAPER_1, CONCEPT_1);

    expect(getMapping(db, PAPER_1, CONCEPT_1)).toBeNull();
    expect(getMapping(db, PAPER_1, CONCEPT_2)).not.toBeNull();
  });
});
