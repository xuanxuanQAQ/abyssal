import {
  validatePaperType,
  validatePaperSource,
  validateFulltextStatus,
  validateAnalysisStatus,
  validateRelevance,
  validateChunkSource,
  validateAnnotationInvariant,
  validateAnnotationType,
  clampConfidence,
  validateRelationType,
  validateEdgeType,
  validateSuggestionStatus,
} from './validators';
import { IntegrityError } from '../types/errors';

describe('validators — enum checks', () => {
  it('accepts valid paper types', () => {
    expect(() => validatePaperType('journal')).not.toThrow();
    expect(() => validatePaperType('conference')).not.toThrow();
    expect(() => validatePaperType('unknown')).not.toThrow();
  });

  it('rejects invalid paper type', () => {
    expect(() => validatePaperType('invalid' as never)).toThrow(IntegrityError);
  });

  it('rejects empty string for all validators', () => {
    expect(() => validatePaperType('' as never)).toThrow(IntegrityError);
    expect(() => validatePaperSource('' as never)).toThrow(IntegrityError);
    expect(() => validateFulltextStatus('' as never)).toThrow(IntegrityError);
    expect(() => validateAnalysisStatus('' as never)).toThrow(IntegrityError);
    expect(() => validateRelevance('' as never)).toThrow(IntegrityError);
    expect(() => validateChunkSource('' as never)).toThrow(IntegrityError);
    expect(() => validateRelationType('' as never)).toThrow(IntegrityError);
    expect(() => validateAnnotationType('' as never)).toThrow(IntegrityError);
    expect(() => validateEdgeType('' as never)).toThrow(IntegrityError);
    expect(() => validateSuggestionStatus('' as never)).toThrow(IntegrityError);
  });

  it('rejects case-variant values (enum is case-sensitive)', () => {
    expect(() => validatePaperType('Journal' as never)).toThrow(IntegrityError);
    expect(() => validateAnalysisStatus('PENDING' as never)).toThrow(IntegrityError);
    expect(() => validateEdgeType('Semantic_Neighbor' as never)).toThrow(IntegrityError);
  });

  it('error message includes the invalid value and allowed list', () => {
    try {
      validatePaperType('bogus' as never);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IntegrityError);
      expect((err as Error).message).toContain('bogus');
      expect((err as Error).message).toContain('journal');
    }
  });

  it('accepts valid analysis statuses', () => {
    expect(() => validateAnalysisStatus('pending')).not.toThrow();
    expect(() => validateAnalysisStatus('in_progress')).not.toThrow();
    expect(() => validateAnalysisStatus('completed')).not.toThrow();
    expect(() => validateAnalysisStatus('failed')).not.toThrow();
  });

  it('rejects old analysis status values', () => {
    expect(() => validateAnalysisStatus('analyzed' as never)).toThrow(IntegrityError);
    expect(() => validateAnalysisStatus('reviewed' as never)).toThrow(IntegrityError);
  });

  it('accepts valid paper sources', () => {
    expect(() => validatePaperSource('semantic_scholar')).not.toThrow();
    expect(() => validatePaperSource('manual')).not.toThrow();
  });

  it('accepts valid fulltext statuses', () => {
    expect(() => validateFulltextStatus('pending')).not.toThrow();
    expect(() => validateFulltextStatus('available')).not.toThrow();
  });

  it('accepts valid relevances', () => {
    expect(() => validateRelevance('high')).not.toThrow();
    expect(() => validateRelevance('excluded')).not.toThrow();
  });

  it('accepts valid chunk sources', () => {
    expect(() => validateChunkSource('paper')).not.toThrow();
    expect(() => validateChunkSource('memo')).not.toThrow();
    expect(() => validateChunkSource('figure')).not.toThrow();
  });

  it('accepts valid relation types', () => {
    expect(() => validateRelationType('supports')).not.toThrow();
    expect(() => validateRelationType('challenges')).not.toThrow();
  });

  it('accepts valid edge types', () => {
    expect(() => validateEdgeType('semantic_neighbor')).not.toThrow();
    expect(() => validateEdgeType('concept_agree')).not.toThrow();
  });

  it('accepts valid suggestion statuses', () => {
    expect(() => validateSuggestionStatus('pending')).not.toThrow();
    expect(() => validateSuggestionStatus('adopted')).not.toThrow();
  });
});

describe('validators — annotation invariant', () => {
  it('accepts conceptTag with concept_id', () => {
    expect(() => validateAnnotationInvariant('conceptTag', 'some_id')).not.toThrow();
  });

  it('rejects conceptTag without concept_id', () => {
    expect(() => validateAnnotationInvariant('conceptTag', null)).toThrow(IntegrityError);
    expect(() => validateAnnotationInvariant('conceptTag', undefined)).toThrow(IntegrityError);
  });

  it('allows highlight without concept_id', () => {
    expect(() => validateAnnotationInvariant('highlight', null)).not.toThrow();
  });

  it('allows note without concept_id', () => {
    expect(() => validateAnnotationInvariant('note', null)).not.toThrow();
  });

  it('accepts valid annotation types', () => {
    expect(() => validateAnnotationType('highlight')).not.toThrow();
    expect(() => validateAnnotationType('note')).not.toThrow();
    expect(() => validateAnnotationType('conceptTag')).not.toThrow();
  });

  it('rejects invalid annotation type', () => {
    expect(() => validateAnnotationType('invalid' as never)).toThrow(IntegrityError);
  });
});

describe('clampConfidence', () => {
  it('clamps value to [0, 1]', () => {
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(0)).toBe(0);
    expect(clampConfidence(1)).toBe(1);
    expect(clampConfidence(-0.1)).toBe(0);
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(100)).toBe(1);
  });

  it('returns 0 for NaN (not NaN — would corrupt DB comparisons)', () => {
    expect(clampConfidence(NaN)).toBe(0);
    expect(Number.isNaN(clampConfidence(NaN))).toBe(false);
  });

  it('returns 0 for Infinity/-Infinity', () => {
    expect(clampConfidence(Infinity)).toBe(0);
    expect(clampConfidence(-Infinity)).toBe(0);
  });
});
