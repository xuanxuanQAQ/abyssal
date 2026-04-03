import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import {
  addAnnotation,
  getAnnotations,
  getAnnotation,
  getAnnotationsByConcept,
  deleteAnnotation,
} from '@core/database/dao/annotations';
import type { PaperId, ConceptId } from '@core/types/common';
import { asPaperId, asConceptId, asAnnotationId } from '@core/types/common';
import type { Annotation } from '@core/types/annotation';
import { IntegrityError } from '@core/types/errors';

// ─── helpers ───

const PAPER_ID = asPaperId('aabbccddeeff');

function insertPaper(db: Database.Database, id: PaperId = PAPER_ID): void {
  db.prepare(
    "INSERT INTO papers (id, title, authors, year, paper_type, source, discovered_at, updated_at) VALUES (?, 'Test Paper', '[]', 2024, 'journal', 'manual', datetime('now'), datetime('now'))",
  ).run(id);
}

function insertConcept(db: Database.Database, id: ConceptId): void {
  db.prepare(
    "INSERT INTO concepts (id, name_zh, name_en, layer, definition, search_keywords, maturity, history, created_at, updated_at) VALUES (?, 'test', 'test', 'core', 'def', '[]', 'tentative', '[]', datetime('now'), datetime('now'))",
  ).run(id);
}

function makeAnnotation(
  overrides?: Partial<Omit<Annotation, 'id'>>,
): Omit<Annotation, 'id'> {
  return {
    paperId: PAPER_ID,
    page: 0,
    rect: { x0: 10, y0: 20, x1: 100, y1: 40 },
    selectedText: 'some highlighted text',
    type: 'highlight',
    color: '#FFEB3B',
    comment: null,
    conceptId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── tests ───

describe('annotations DAO', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
    insertPaper(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── addAnnotation ──

  it('addAnnotation returns an AnnotationId', () => {
    const id = addAnnotation(db, makeAnnotation());
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('addAnnotation concept_tag without conceptId throws IntegrityError', () => {
    expect(() =>
      addAnnotation(
        db,
        makeAnnotation({ type: 'conceptTag', conceptId: null }),
      ),
    ).toThrow(IntegrityError);
  });

  it('addAnnotation highlight without conceptId succeeds', () => {
    const id = addAnnotation(
      db,
      makeAnnotation({ type: 'highlight', conceptId: null }),
    );
    expect(id).toBeGreaterThan(0);
  });

  it('addAnnotation concept_tag with conceptId succeeds', () => {
    const conceptId = asConceptId('attention_mechanism');
    insertConcept(db, conceptId);

    const id = addAnnotation(
      db,
      makeAnnotation({ type: 'conceptTag', conceptId }),
    );
    expect(id).toBeGreaterThan(0);

    const ann = getAnnotation(db, id);
    expect(ann).not.toBeNull();
    expect(ann!.type).toBe('conceptTag');
    expect(ann!.conceptId).toBe(conceptId);
  });

  // ── getAnnotations ──

  it('getAnnotations returns annotations sorted by page then rect_y0', () => {
    // Insert annotations on different pages and y-positions
    addAnnotation(db, makeAnnotation({ page: 3, rect: { x0: 0, y0: 80, x1: 1, y1: 90 } }));
    addAnnotation(db, makeAnnotation({ page: 1, rect: { x0: 0, y0: 50, x1: 1, y1: 60 } }));
    addAnnotation(db, makeAnnotation({ page: 1, rect: { x0: 0, y0: 10, x1: 1, y1: 20 } }));
    addAnnotation(db, makeAnnotation({ page: 2, rect: { x0: 0, y0: 30, x1: 1, y1: 40 } }));

    const results = getAnnotations(db, PAPER_ID);
    expect(results).toHaveLength(4);

    // Sorted: page 1 y0=10, page 1 y0=50, page 2 y0=30, page 3 y0=80
    expect(results[0]!.page).toBe(1);
    expect(results[0]!.rect.y0).toBe(10);
    expect(results[1]!.page).toBe(1);
    expect(results[1]!.rect.y0).toBe(50);
    expect(results[2]!.page).toBe(2);
    expect(results[3]!.page).toBe(3);
  });

  it('getAnnotations returns empty array for paper with no annotations', () => {
    const otherId = asPaperId('112233445566');
    insertPaper(db, otherId);
    const results = getAnnotations(db, otherId);
    expect(results).toEqual([]);
  });

  // ── getAnnotationsByConcept ──

  it('getAnnotationsByConcept returns only matching annotations', () => {
    const c1 = asConceptId('concept_alpha');
    const c2 = asConceptId('concept_beta');
    insertConcept(db, c1);
    insertConcept(db, c2);

    addAnnotation(db, makeAnnotation({ type: 'conceptTag', conceptId: c1 }));
    addAnnotation(db, makeAnnotation({ type: 'conceptTag', conceptId: c1 }));
    addAnnotation(db, makeAnnotation({ type: 'conceptTag', conceptId: c2 }));
    addAnnotation(db, makeAnnotation({ type: 'highlight' }));

    const byC1 = getAnnotationsByConcept(db, c1);
    expect(byC1).toHaveLength(2);
    byC1.forEach((a) => expect(a.conceptId).toBe(c1));

    const byC2 = getAnnotationsByConcept(db, c2);
    expect(byC2).toHaveLength(1);
    expect(byC2[0]!.conceptId).toBe(c2);
  });

  // ── deleteAnnotation ──

  it('deleteAnnotation existing annotation returns 1', () => {
    const id = addAnnotation(db, makeAnnotation());
    const changes = deleteAnnotation(db, id);
    expect(changes).toBe(1);

    // Verify it is gone
    const ann = getAnnotation(db, id);
    expect(ann).toBeNull();
  });

  it('deleteAnnotation non-existent annotation returns 0', () => {
    const changes = deleteAnnotation(db, asAnnotationId(99999));
    expect(changes).toBe(0);
  });
});
