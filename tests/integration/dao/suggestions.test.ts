import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import {
  addSuggestedConcept,
  getSuggestedConcepts,
  getSuggestedConcept,
  adoptSuggestedConcept,
  dismissSuggestedConcept,
} from '@core/database/dao/suggestions';
import { getConcept } from '@core/database/dao/concepts';
import type { PaperId } from '@core/types/common';
import { asPaperId } from '@core/types/common';
import { IntegrityError } from '@core/types/errors';

// ─── helpers ───

const PAPER_A = asPaperId('aabbccddeeff');
const PAPER_B = asPaperId('112233445566');

function insertPaper(db: Database.Database, id: PaperId): void {
  db.prepare(
    "INSERT INTO papers (id, title, authors, year, paper_type, source, discovered_at, updated_at) VALUES (?, 'Paper', '[]', 2024, 'journal', 'manual', datetime('now'), datetime('now'))",
  ).run(id);
}

// ─── tests ───

describe('suggestions DAO', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
    insertPaper(db, PAPER_A);
    insertPaper(db, PAPER_B);
  });

  afterEach(() => {
    db.close();
  });

  // ── addSuggestedConcept ──

  it('addSuggestedConcept returns a SuggestionId', () => {
    const id = addSuggestedConcept(db, {
      term: 'Attention Mechanism',
      frequencyInPaper: 5,
      sourcePaperId: PAPER_A,
      reason: 'Frequently referenced core concept',
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('addSuggestedConcept deduplicates by term_normalized', () => {
    const id1 = addSuggestedConcept(db, {
      term: 'Attention Mechanism',
      frequencyInPaper: 3,
      sourcePaperId: PAPER_A,
      reason: 'short reason',
    });

    // Same term (different casing), different paper
    const id2 = addSuggestedConcept(db, {
      term: 'attention mechanism',
      frequencyInPaper: 2,
      sourcePaperId: PAPER_B,
      reason: 'a much longer reason that should replace the shorter one',
    });

    expect(id2).toBe(id1);

    const suggestion = getSuggestedConcept(db, id1)!;
    expect(suggestion.frequency).toBe(5); // 3 + 2
    expect(suggestion.sourcePaperCount).toBe(2);
    expect(suggestion.sourcePaperIds).toContain(PAPER_A);
    expect(suggestion.sourcePaperIds).toContain(PAPER_B);
  });

  // ── getSuggestedConcepts ──

  it('getSuggestedConcepts returns pending by default', () => {
    addSuggestedConcept(db, {
      term: 'Term A',
      frequencyInPaper: 1,
      sourcePaperId: PAPER_A,
      reason: 'reason a',
    });
    addSuggestedConcept(db, {
      term: 'Term B',
      frequencyInPaper: 1,
      sourcePaperId: PAPER_A,
      reason: 'reason b',
    });

    // Without status filter, returns all (no WHERE clause)
    const all = getSuggestedConcepts(db);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // With 'pending' filter
    const pending = getSuggestedConcepts(db, 'pending');
    expect(pending).toHaveLength(2);
    pending.forEach((s) => expect(s.status).toBe('pending'));
  });

  it('getSuggestedConcepts with status filter works for adopted/dismissed', () => {
    const id1 = addSuggestedConcept(db, {
      term: 'Adopted Term',
      frequencyInPaper: 3,
      sourcePaperId: PAPER_A,
      reason: 'will be adopted',
    });
    const id2 = addSuggestedConcept(db, {
      term: 'Dismissed Term',
      frequencyInPaper: 1,
      sourcePaperId: PAPER_A,
      reason: 'will be dismissed',
    });
    addSuggestedConcept(db, {
      term: 'Still Pending',
      frequencyInPaper: 1,
      sourcePaperId: PAPER_A,
      reason: 'stays pending',
    });

    adoptSuggestedConcept(db, id1);
    dismissSuggestedConcept(db, id2);

    const adopted = getSuggestedConcepts(db, 'adopted');
    expect(adopted).toHaveLength(1);
    expect(adopted[0]!.term).toBe('Adopted Term');
    expect(adopted[0]!.status).toBe('adopted');

    const dismissed = getSuggestedConcepts(db, 'dismissed');
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]!.term).toBe('Dismissed Term');
    expect(dismissed[0]!.status).toBe('dismissed');

    const pending = getSuggestedConcepts(db, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.term).toBe('Still Pending');
  });

  // ── adoptSuggestedConcept ──

  it('adoptSuggestedConcept creates concept and sets status to adopted', () => {
    const sugId = addSuggestedConcept(db, {
      term: 'Gradient Descent',
      frequencyInPaper: 10,
      sourcePaperId: PAPER_A,
      reason: 'Core optimization algorithm',
    });

    const conceptId = adoptSuggestedConcept(db, sugId);

    // Concept was created
    expect(typeof conceptId).toBe('string');
    const concept = getConcept(db, conceptId);
    expect(concept).not.toBeNull();
    expect(concept!.nameEn).toBe('Gradient Descent');
    expect(concept!.maturity).toBe('tentative');
    expect(concept!.definition).toBe('Core optimization algorithm');

    // Suggestion status updated
    const suggestion = getSuggestedConcept(db, sugId)!;
    expect(suggestion.status).toBe('adopted');
    expect(suggestion.adoptedConceptId).toBe(conceptId);
  });

  it('adoptSuggestedConcept on already-adopted suggestion throws IntegrityError', () => {
    const sugId = addSuggestedConcept(db, {
      term: 'Backpropagation',
      frequencyInPaper: 5,
      sourcePaperId: PAPER_A,
      reason: 'Key training algorithm',
    });

    // First adoption succeeds
    adoptSuggestedConcept(db, sugId);

    // Second adoption should throw
    expect(() => adoptSuggestedConcept(db, sugId)).toThrow(IntegrityError);
  });

  it('adoptSuggestedConcept on dismissed suggestion throws IntegrityError', () => {
    const sugId = addSuggestedConcept(db, {
      term: 'Some Dismissed Term',
      frequencyInPaper: 1,
      sourcePaperId: PAPER_A,
      reason: 'will be dismissed first',
    });

    dismissSuggestedConcept(db, sugId);

    expect(() => adoptSuggestedConcept(db, sugId)).toThrow(IntegrityError);
  });

  // ── dismissSuggestedConcept ──

  it('dismissSuggestedConcept sets status to dismissed', () => {
    const sugId = addSuggestedConcept(db, {
      term: 'Noisy Term',
      frequencyInPaper: 1,
      sourcePaperId: PAPER_A,
      reason: 'Low quality suggestion',
    });

    const changes = dismissSuggestedConcept(db, sugId);
    expect(changes).toBe(1);

    const suggestion = getSuggestedConcept(db, sugId)!;
    expect(suggestion.status).toBe('dismissed');
  });

  it('dismissSuggestedConcept on non-pending returns 0 changes', () => {
    const sugId = addSuggestedConcept(db, {
      term: 'Already Gone',
      frequencyInPaper: 1,
      sourcePaperId: PAPER_A,
      reason: 'test',
    });

    // Dismiss once
    dismissSuggestedConcept(db, sugId);

    // Dismiss again: not pending anymore, 0 changes
    const changes = dismissSuggestedConcept(db, sugId);
    expect(changes).toBe(0);
  });
});
