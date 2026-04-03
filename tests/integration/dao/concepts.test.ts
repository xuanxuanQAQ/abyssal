/**
 * Integration tests for conceptsDao — lifecycle, hierarchy, cycle detection,
 * merge/split, deprecation, and history tracking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import { asPaperId, asConceptId } from '../../../src/core/types/common';
import type { ConceptId } from '../../../src/core/types/common';
import type { ConceptDefinition } from '../../../src/core/types/concept';
import * as conceptsDao from '../../../src/core/database/dao/concepts';
import * as mappingsDao from '../../../src/core/database/dao/mappings';
import * as papersDao from '../../../src/core/database/dao/papers';
import type { PaperMetadata } from '../../../src/core/types/paper';
import { IntegrityError } from '../../../src/core/types/errors';

// ─── Fixture helpers ───

function makeConcept(overrides: Partial<ConceptDefinition> & { id: ConceptId }): ConceptDefinition {
  return {
    nameZh: '测试概念',
    nameEn: 'Test Concept',
    layer: 'core',
    definition: 'A concept used for testing purposes.',
    searchKeywords: ['test', 'concept'],
    maturity: 'tentative',
    parentId: null,
    history: [],
    deprecated: false,
    deprecatedAt: null,
    deprecatedReason: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePaper(id: string, title: string): PaperMetadata {
  return {
    id: asPaperId(id),
    title,
    authors: ['Test, Author'],
    year: 2024,
    doi: null,
    arxivId: null,
    abstract: null,
    citationCount: null,
    paperType: 'journal',
    source: 'manual',
    venue: null,
    journal: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: null,
    pmid: null,
    pmcid: null,
    url: null,
    bibtexKey: null,
    biblioComplete: false,
  };
}

function addMapping(
  db: Database.Database,
  paperId: string,
  conceptId: string,
  confidence: number = 0.9,
  relation: string = 'supports',
) {
  mappingsDao.mapPaperConcept(db, {
    paperId: asPaperId(paperId),
    conceptId: asConceptId(conceptId),
    relation: relation as 'supports',
    confidence,
    evidence: {
      en: 'Test evidence.',
      original: '测试证据。',
      originalLang: 'zh-CN',
      chunkId: null,
      page: null,
      annotationId: null,
    },
    annotationId: null,
    reviewed: false,
    reviewedAt: null,
  });
}

describe('conceptsDao', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
  });

  afterEach(() => {
    db.close();
  });

  // ─── addConcept ───

  it('addConcept creates with initial history entry', () => {
    const concept = makeConcept({ id: asConceptId('deep_learning') });
    conceptsDao.addConcept(db, concept);

    const stored = conceptsDao.getConcept(db, asConceptId('deep_learning'));
    expect(stored).not.toBeNull();
    expect(stored!.nameEn).toBe('Test Concept');
    expect(stored!.layer).toBe('core');
    expect(stored!.maturity).toBe('tentative');
    expect(stored!.deprecated).toBe(false);

    // History should have exactly one 'created' entry
    expect(stored!.history).toHaveLength(1);
    expect(stored!.history[0]!.changeType).toBe('created');
    expect(stored!.history[0]!.isBreaking).toBe(false);
  });

  it('addConcept rejects invalid ConceptId format', () => {
    const concept = makeConcept({ id: 'Invalid-ID' as ConceptId });
    expect(() => conceptsDao.addConcept(db, concept)).toThrow(IntegrityError);
  });

  it('addConcept rejects duplicate id', () => {
    const concept = makeConcept({ id: asConceptId('transformer') });
    conceptsDao.addConcept(db, concept);
    expect(() => conceptsDao.addConcept(db, concept)).toThrow();
  });

  // ─── updateConcept ───

  describe('updateConcept', () => {
    const conceptId = asConceptId('attention');

    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({
        id: conceptId,
        nameEn: 'Attention',
        definition: 'A mechanism for weighting inputs.',
        searchKeywords: ['attention', 'weights'],
        maturity: 'tentative',
      }));
    });

    it('definition change records history', () => {
      const result = conceptsDao.updateConcept(db, conceptId, {
        definition: 'A fully revised definition of the attention mechanism in neural networks.',
      });

      const stored = conceptsDao.getConcept(db, conceptId)!;
      expect(stored.definition).toBe(
        'A fully revised definition of the attention mechanism in neural networks.',
      );

      // History should have 'created' + 'definition_refined'
      expect(stored.history).toHaveLength(2);
      expect(stored.history[1]!.changeType).toBe('definition_refined');
      expect(stored.history[1]!.oldValueSummary).toBe(
        'A mechanism for weighting inputs.',
      );

      // gcConceptChange should return result
      expect(result.affectedMappings).toBeGreaterThanOrEqual(0);
    });

    it('keyword additions and removals record separate history entries', () => {
      conceptsDao.updateConcept(db, conceptId, {
        searchKeywords: ['attention', 'self_attention', 'multi_head'],
      });

      const stored = conceptsDao.getConcept(db, conceptId)!;
      expect(stored.searchKeywords).toEqual(['attention', 'self_attention', 'multi_head']);

      // Should have 'created' + 'keywords_added' + 'keywords_removed'
      const changeTypes = stored.history.map((h) => h.changeType);
      expect(changeTypes).toContain('keywords_added');
      expect(changeTypes).toContain('keywords_removed');
    });

    it('maturity upgrade records history', () => {
      conceptsDao.updateConcept(db, conceptId, { maturity: 'working' });

      const stored = conceptsDao.getConcept(db, conceptId)!;
      expect(stored.maturity).toBe('working');

      const upgradeEntry = stored.history.find((h) => h.changeType === 'maturity_upgraded');
      expect(upgradeEntry).toBeDefined();
      expect(upgradeEntry!.metadata).toEqual({ from: 'tentative', to: 'working' });
    });

    it('maturity downgrade records history', () => {
      // First upgrade to established
      conceptsDao.updateConcept(db, conceptId, { maturity: 'established' });
      // Then downgrade
      conceptsDao.updateConcept(db, conceptId, { maturity: 'tentative' });

      const stored = conceptsDao.getConcept(db, conceptId)!;
      expect(stored.maturity).toBe('tentative');

      const downgradeEntry = stored.history.find((h) => h.changeType === 'maturity_downgraded');
      expect(downgradeEntry).toBeDefined();
    });

    it('layer change records history', () => {
      conceptsDao.updateConcept(db, conceptId, { layer: 'methodological' });

      const stored = conceptsDao.getConcept(db, conceptId)!;
      expect(stored.layer).toBe('methodological');

      const layerEntry = stored.history.find((h) => h.changeType === 'layer_changed');
      expect(layerEntry).toBeDefined();
      expect(layerEntry!.metadata).toEqual({ from: 'core', to: 'methodological' });
    });

    it('no-op update does not add history entries', () => {
      conceptsDao.updateConcept(db, conceptId, {
        definition: 'A mechanism for weighting inputs.', // same value
      });

      const stored = conceptsDao.getConcept(db, conceptId)!;
      // Should only have the initial 'created' entry
      expect(stored.history).toHaveLength(1);
    });
  });

  // ─── parentId and cycle detection ───

  describe('parentId cycle detection', () => {
    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('concept_a'),
        nameEn: 'Concept A',
      }));
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('concept_b'),
        nameEn: 'Concept B',
        parentId: asConceptId('concept_a'),
      }));
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('concept_c'),
        nameEn: 'Concept C',
        parentId: asConceptId('concept_b'),
      }));
    });

    it('self-parent throws IntegrityError', () => {
      expect(() =>
        conceptsDao.updateConcept(db, asConceptId('concept_a'), {
          parentId: asConceptId('concept_a'),
        }),
      ).toThrow(IntegrityError);
    });

    it('direct cycle (A->B->A) throws IntegrityError', () => {
      // A is parent of B. Setting A's parent to B creates A->B->A.
      expect(() =>
        conceptsDao.updateConcept(db, asConceptId('concept_a'), {
          parentId: asConceptId('concept_b'),
        }),
      ).toThrow(IntegrityError);
    });

    it('indirect cycle (A->B->C->A) throws IntegrityError', () => {
      // Chain: C->B->A. Setting A's parent to C creates A->C->B->A.
      expect(() =>
        conceptsDao.updateConcept(db, asConceptId('concept_a'), {
          parentId: asConceptId('concept_c'),
        }),
      ).toThrow(IntegrityError);
    });

    it('self-parent on addConcept throws IntegrityError', () => {
      expect(() =>
        conceptsDao.addConcept(db, makeConcept({
          id: asConceptId('concept_x'),
          parentId: asConceptId('concept_x'),
        })),
      ).toThrow(IntegrityError);
    });

    it('valid parent assignment works', () => {
      // concept_a has no parent. Setting it as parent of a new concept is valid.
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('concept_d'),
        parentId: asConceptId('concept_a'),
      }));

      const stored = conceptsDao.getConcept(db, asConceptId('concept_d'))!;
      expect(stored.parentId).toBe(asConceptId('concept_a'));
    });

    it('setting parentId to null is valid', () => {
      conceptsDao.updateConcept(db, asConceptId('concept_b'), {
        parentId: null,
      });

      const stored = conceptsDao.getConcept(db, asConceptId('concept_b'))!;
      expect(stored.parentId).toBeNull();
    });
  });

  // ─── deprecateConcept ───

  describe('deprecateConcept', () => {
    const conceptId = asConceptId('old_concept');

    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({
        id: conceptId,
        nameEn: 'Old Concept',
      }));
    });

    it('sets deprecated flags', () => {
      conceptsDao.deprecateConcept(db, conceptId, 'No longer relevant');

      const stored = conceptsDao.getConcept(db, conceptId)!;
      expect(stored.deprecated).toBe(true);
      expect(stored.deprecatedReason).toBe('No longer relevant');
      expect(stored.deprecatedAt).toBeTruthy();
    });

    it('appends deprecated history entry', () => {
      conceptsDao.deprecateConcept(db, conceptId, 'Superseded');

      const stored = conceptsDao.getConcept(db, conceptId)!;
      const deprecatedEntry = stored.history.find((h) => h.changeType === 'deprecated');
      expect(deprecatedEntry).toBeDefined();
      expect(deprecatedEntry!.reason).toBe('Superseded');
    });

    it('throws when deprecating already deprecated concept', () => {
      conceptsDao.deprecateConcept(db, conceptId, 'First');
      // getConceptOrThrow with mustBeActive=true should throw
      expect(() =>
        conceptsDao.deprecateConcept(db, conceptId, 'Second'),
      ).toThrow(IntegrityError);
    });

    it('returns gc result with affected paper ids', () => {
      const paperId = asPaperId('aabbccddeeff');
      papersDao.addPaper(db, makePaper('aabbccddeeff', 'Test Paper'));
      addMapping(db, 'aabbccddeeff', 'old_concept');

      const result = conceptsDao.deprecateConcept(db, conceptId, 'Outdated');

      expect(result.affectedPaperIds).toContain(paperId);
      expect(result.affectedMappings).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── mergeConcepts ───

  describe('mergeConcepts', () => {
    const keepId = asConceptId('keep_concept');
    const mergeId = asConceptId('merge_concept');
    const paperId1 = asPaperId('111111111111');
    const paperId2 = asPaperId('222222222222');
    const paperId3 = asPaperId('333333333333');

    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({
        id: keepId,
        nameEn: 'Keep Concept',
        searchKeywords: ['keep', 'primary'],
      }));
      conceptsDao.addConcept(db, makeConcept({
        id: mergeId,
        nameEn: 'Merge Concept',
        searchKeywords: ['merge', 'secondary'],
      }));

      // Papers
      papersDao.addPaper(db, makePaper('111111111111', 'Paper 1'));
      papersDao.addPaper(db, makePaper('222222222222', 'Paper 2'));
      papersDao.addPaper(db, makePaper('333333333333', 'Paper 3'));

      // Paper 1 mapped to keep only
      addMapping(db, '111111111111', 'keep_concept', 0.8);
      // Paper 2 mapped to merge only
      addMapping(db, '222222222222', 'merge_concept', 0.7);
      // Paper 3 mapped to both (conflict)
      addMapping(db, '333333333333', 'keep_concept', 0.6);
      addMapping(db, '333333333333', 'merge_concept', 0.9);
    });

    it('moves non-conflicting mappings to keep concept', () => {
      const result = conceptsDao.mergeConcepts(db, keepId, mergeId);

      // Paper 2 was only on merge, should now be on keep
      const paper2Mappings = mappingsDao.getMappingsByPaper(db, paperId2);
      expect(paper2Mappings.some((m) => m.conceptId === keepId)).toBe(true);
      expect(paper2Mappings.some((m) => m.conceptId === mergeId)).toBe(false);

      expect(result.migratedMappings).toBeGreaterThanOrEqual(1);
    });

    it('detects conflicting mappings', () => {
      const result = conceptsDao.mergeConcepts(db, keepId, mergeId);

      // Paper 3 was mapped to both concepts — conflict detected
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.paperId).toBe(paperId3);
    });

    it('max_confidence resolution keeps highest confidence for conflicts', () => {
      const result = conceptsDao.mergeConcepts(db, keepId, mergeId, 'max_confidence');

      // Paper 3: keep had 0.6, merge had 0.9. Should now have 0.9 on keep.
      const paper3Mapping = mappingsDao.getMapping(db, paperId3, keepId);
      expect(paper3Mapping).not.toBeNull();
      expect(paper3Mapping!.confidence).toBeCloseTo(0.9);
    });

    it('deprecates the merged concept', () => {
      conceptsDao.mergeConcepts(db, keepId, mergeId);

      const merged = conceptsDao.getConcept(db, mergeId)!;
      expect(merged.deprecated).toBe(true);
      expect(merged.deprecatedReason).toContain('Merged into');
    });

    it('merges search_keywords', () => {
      conceptsDao.mergeConcepts(db, keepId, mergeId);

      const keep = conceptsDao.getConcept(db, keepId)!;
      expect(keep.searchKeywords).toContain('keep');
      expect(keep.searchKeywords).toContain('primary');
      expect(keep.searchKeywords).toContain('merge');
      expect(keep.searchKeywords).toContain('secondary');
    });

    it('records merged_from history on keep concept', () => {
      conceptsDao.mergeConcepts(db, keepId, mergeId);

      const keep = conceptsDao.getConcept(db, keepId)!;
      const mergedEntry = keep.history.find((h) => h.changeType === 'merged_from');
      expect(mergedEntry).toBeDefined();
      expect(mergedEntry!.metadata).toEqual({
        sourceConceptId: mergeId,
        sourceConceptName: 'Merge Concept',
      });
    });

    it('returns affected papers list', () => {
      const result = conceptsDao.mergeConcepts(db, keepId, mergeId);

      // All three papers should be affected
      expect(result.affectedPapers).toContain(paperId1);
      expect(result.affectedPapers).toContain(paperId3);
    });

    it('throws when merging concept with itself', () => {
      expect(() =>
        conceptsDao.mergeConcepts(db, keepId, keepId),
      ).toThrow(IntegrityError);
    });

    it('keep resolution preserves keep-side mapping', () => {
      conceptsDao.mergeConcepts(db, keepId, mergeId, 'keep');

      // Paper 3: keep had 0.6, should remain 0.6
      const paper3Mapping = mappingsDao.getMapping(db, paperId3, keepId);
      expect(paper3Mapping).not.toBeNull();
      expect(paper3Mapping!.confidence).toBeCloseTo(0.6);
    });
  });

  // ─── splitConcept ───

  describe('splitConcept', () => {
    const originalId = asConceptId('neural_network');
    const splitAId = asConceptId('feedforward_nn');
    const splitBId = asConceptId('recurrent_nn');
    const paperId = asPaperId('aabbccddeeff');

    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({
        id: originalId,
        nameEn: 'Neural Network',
        nameZh: '神经网络',
        maturity: 'established',
        searchKeywords: ['neural', 'network', 'nn'],
      }));

      papersDao.addPaper(db, makePaper('aabbccddeeff', 'NN Foundations'));
      addMapping(db, 'aabbccddeeff', 'neural_network', 0.85);
    });

    it('creates two new concepts', () => {
      const result = conceptsDao.splitConcept(
        db,
        originalId,
        makeConcept({
          id: splitAId,
          nameEn: 'Feedforward NN',
          nameZh: '前馈神经网络',
          maturity: 'working',
        }),
        makeConcept({
          id: splitBId,
          nameEn: 'Recurrent NN',
          nameZh: '循环神经网络',
          maturity: 'working',
        }),
      );

      expect(result.conceptA).toBe(splitAId);
      expect(result.conceptB).toBe(splitBId);

      const conceptA = conceptsDao.getConcept(db, splitAId)!;
      expect(conceptA.nameEn).toBe('Feedforward NN');
      expect(conceptA.maturity).toBe('working');

      const conceptB = conceptsDao.getConcept(db, splitBId)!;
      expect(conceptB.nameEn).toBe('Recurrent NN');
    });

    it('returns pending mappings from original concept', () => {
      const result = conceptsDao.splitConcept(
        db,
        originalId,
        makeConcept({ id: splitAId, nameEn: 'A' }),
        makeConcept({ id: splitBId, nameEn: 'B' }),
      );

      expect(result.pendingMappings).toHaveLength(1);
      expect(result.pendingMappings[0]!.paperId).toBe(paperId);
      expect(result.pendingMappings[0]!.conceptId).toBe(originalId);
    });

    it('records split_into history on new concepts', () => {
      conceptsDao.splitConcept(
        db,
        originalId,
        makeConcept({ id: splitAId, nameEn: 'A' }),
        makeConcept({ id: splitBId, nameEn: 'B' }),
      );

      const conceptA = conceptsDao.getConcept(db, splitAId)!;
      const splitEntry = conceptA.history.find((h) => h.changeType === 'split_into');
      expect(splitEntry).toBeDefined();
      expect(splitEntry!.metadata).toEqual({ originalConceptId: originalId });
    });

    it('records split_into history on original concept', () => {
      conceptsDao.splitConcept(
        db,
        originalId,
        makeConcept({ id: splitAId, nameEn: 'A' }),
        makeConcept({ id: splitBId, nameEn: 'B' }),
      );

      const original = conceptsDao.getConcept(db, originalId)!;
      const splitEntry = original.history.find((h) => h.changeType === 'split_into');
      expect(splitEntry).toBeDefined();
      expect(splitEntry!.metadata).toEqual({
        newConceptIds: [splitAId, splitBId],
      });
    });

    it('original concept retains its mappings (caller reassigns)', () => {
      conceptsDao.splitConcept(
        db,
        originalId,
        makeConcept({ id: splitAId, nameEn: 'A' }),
        makeConcept({ id: splitBId, nameEn: 'B' }),
      );

      // Original concept still has its mapping (split does NOT auto-reassign)
      const originalMappings = mappingsDao.getMappingsByConcept(db, originalId);
      expect(originalMappings).toHaveLength(1);
    });
  });

  // ─── getAllConcepts ───

  describe('getAllConcepts', () => {
    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('active_one'),
        nameEn: 'Active One',
      }));
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('active_two'),
        nameEn: 'Active Two',
      }));
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('deprecated_one'),
        nameEn: 'Deprecated One',
      }));
      conceptsDao.deprecateConcept(db, asConceptId('deprecated_one'), 'Obsolete');
    });

    it('excludes deprecated by default', () => {
      const concepts = conceptsDao.getAllConcepts(db);
      expect(concepts).toHaveLength(2);
      const names = concepts.map((c) => c.nameEn);
      expect(names).toContain('Active One');
      expect(names).toContain('Active Two');
      expect(names).not.toContain('Deprecated One');
    });

    it('includes deprecated when requested', () => {
      const concepts = conceptsDao.getAllConcepts(db, true);
      expect(concepts).toHaveLength(3);
      const names = concepts.map((c) => c.nameEn);
      expect(names).toContain('Deprecated One');
    });

    it('returns concepts ordered by created_at', () => {
      const concepts = conceptsDao.getAllConcepts(db);
      // active_one was created before active_two
      expect(concepts[0]!.nameEn).toBe('Active One');
      expect(concepts[1]!.nameEn).toBe('Active Two');
    });
  });

  // ─── getConcept ───

  it('getConcept returns null for missing concept', () => {
    const result = conceptsDao.getConcept(db, asConceptId('nonexistent'));
    expect(result).toBeNull();
  });

  it('getConcept returns deprecated concepts (not filtered)', () => {
    conceptsDao.addConcept(db, makeConcept({
      id: asConceptId('will_deprecate'),
      nameEn: 'Will Deprecate',
    }));
    conceptsDao.deprecateConcept(db, asConceptId('will_deprecate'), 'Gone');

    const stored = conceptsDao.getConcept(db, asConceptId('will_deprecate'));
    expect(stored).not.toBeNull();
    expect(stored!.deprecated).toBe(true);
  });

  // ─── gcConceptChange ───

  describe('gcConceptChange', () => {
    const conceptId = asConceptId('gc_concept');
    const paperId = asPaperId('aabbccddeeff');

    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({ id: conceptId }));
      papersDao.addPaper(db, makePaper('aabbccddeeff', 'Test Paper'));
      addMapping(db, 'aabbccddeeff', 'gc_concept');
    });

    it('definition_refined non-breaking marks recent mappings unreviewed', () => {
      const result = conceptsDao.gcConceptChange(
        db, conceptId, 'definition_refined', false, 30,
      );

      expect(result.requiresRelationRecompute).toBe(false);
      expect(result.requiresSynthesizeRefresh).toBe(true);
    });

    it('definition_refined breaking marks all mappings and flags recompute', () => {
      const result = conceptsDao.gcConceptChange(
        db, conceptId, 'definition_refined', true, 30,
      );

      expect(result.requiresRelationRecompute).toBe(true);
      expect(result.requiresSynthesizeRefresh).toBe(true);
      expect(result.affectedPaperIds).toContain(paperId);
    });

    it('deleted removes concept and its mappings', () => {
      const result = conceptsDao.gcConceptChange(
        db, conceptId, 'deleted', false,
      );

      expect(result.affectedPaperIds).toContain(paperId);
      expect(result.affectedMappings).toBeGreaterThanOrEqual(1);

      // Concept should be gone
      const stored = conceptsDao.getConcept(db, conceptId);
      expect(stored).toBeNull();

      // Mapping should be gone
      const mappings = mappingsDao.getMappingsByConcept(db, conceptId);
      expect(mappings).toHaveLength(0);
    });
  });

  // ─── syncConcepts ───

  describe('syncConcepts', () => {
    beforeEach(() => {
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('existing_one'),
        nameEn: 'Existing One',
        definition: 'Original definition.',
      }));
      conceptsDao.addConcept(db, makeConcept({
        id: asConceptId('existing_two'),
        nameEn: 'Existing Two',
        definition: 'Another definition.',
      }));
    });

    it('merge strategy adds new and updates existing', () => {
      const result = conceptsDao.syncConcepts(db, [
        makeConcept({
          id: asConceptId('existing_one'),
          nameEn: 'Existing One Updated',
          definition: 'Updated definition.',
        }),
        makeConcept({
          id: asConceptId('brand_new'),
          nameEn: 'Brand New',
        }),
      ], 'merge');

      expect(result.added).toContain(asConceptId('brand_new'));
      expect(result.updated).toContain(asConceptId('existing_one'));
      expect(result.deprecated).toHaveLength(0);

      // existing_two should still be active
      const two = conceptsDao.getConcept(db, asConceptId('existing_two'))!;
      expect(two.deprecated).toBe(false);
    });

    it('replace strategy deprecates concepts not in new list', () => {
      const result = conceptsDao.syncConcepts(db, [
        makeConcept({
          id: asConceptId('existing_one'),
          nameEn: 'Existing One',
          definition: 'Original definition.',
        }),
      ], 'replace');

      expect(result.deprecated).toContain(asConceptId('existing_two'));

      const two = conceptsDao.getConcept(db, asConceptId('existing_two'))!;
      expect(two.deprecated).toBe(true);
    });
  });
});
