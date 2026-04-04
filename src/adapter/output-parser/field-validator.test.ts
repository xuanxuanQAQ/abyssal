import {
  validateConceptMappings,
  levenshteinDistance,
  detectLanguage,
  type ConceptLookup,
} from './field-validator';

describe('validateConceptMappings', () => {
  const knownIds = new Set(['theory_of_mind', 'affordance', 'social_presence']);
  const lookup: ConceptLookup = {
    exists: (id) => knownIds.has(id),
    allIds: knownIds,
  };

  describe('valid mappings', () => {
    it('passes through a well-formed mapping with known concept', () => {
      const result = validateConceptMappings([{
        concept_id: 'theory_of_mind',
        relation: 'supports',
        confidence: 0.85,
        evidence: 'Some evidence text',
      }], lookup);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]!.concept_id).toBe('theory_of_mind');
      expect(result.mappings[0]!.relation).toBe('supports');
      expect(result.mappings[0]!.confidence).toBe(0.85);
      expect(result.warnings).toHaveLength(0);
    });

    it('accepts all valid relation types', () => {
      for (const rel of ['supports', 'challenges', 'extends', 'operationalizes', 'irrelevant']) {
        const result = validateConceptMappings([{
          concept_id: 'affordance', relation: rel, confidence: 0.5,
        }], lookup);
        expect(result.mappings[0]!.relation).toBe(rel);
      }
    });
  });

  describe('relation synonym mapping', () => {
    it.each([
      ['support', 'supports'],
      ['challenge', 'challenges'],
      ['extend', 'extends'],
      ['operationalize', 'operationalizes'],
      ['contradicts', 'challenges'],
      ['confirms', 'supports'],
      ['builds_on', 'extends'],
      ['applies', 'operationalizes'],
      ['not_relevant', 'irrelevant'],
      ['unrelated', 'irrelevant'],
      ['none', 'irrelevant'],
    ])('maps "%s" to "%s"', (input, expected) => {
      const result = validateConceptMappings([{
        concept_id: 'affordance', relation: input, confidence: 0.5,
      }], lookup);
      expect(result.mappings[0]!.relation).toBe(expected);
      expect(result.warnings.some(w => w.includes('mapped to'))).toBe(true);
    });

    it('defaults invalid relation to "supports" with warning', () => {
      const result = validateConceptMappings([{
        concept_id: 'affordance', relation: 'completely_unknown', confidence: 0.5,
      }], lookup);
      expect(result.mappings[0]!.relation).toBe('supports');
      expect(result.warnings.some(w => w.includes('defaulting to "supports"'))).toBe(true);
    });
  });

  describe('confidence normalization', () => {
    it('clamps to [0, 1]', () => {
      const result = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: -0.5 },
      ], lookup);
      expect(result.mappings[0]!.confidence).toBe(0.0);
    });

    it('treats values > 1 and ≤ 100 as percentages', () => {
      const result = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: 85 },
      ], lookup);
      expect(result.mappings[0]!.confidence).toBe(0.85);
    });

    it('treats values > 100 as 1.0', () => {
      const result = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: 150 },
      ], lookup);
      expect(result.mappings[0]!.confidence).toBe(1.0);
    });

    it.each([
      ['very high', 0.95],
      ['high', 0.85],
      ['medium', 0.55],
      ['low', 0.25],
      ['very low', 0.15],
      ['none', 0.05],
    ])('maps text "%s" to %f', (text, expected) => {
      const result = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: text },
      ], lookup);
      expect(result.mappings[0]!.confidence).toBe(expected);
    });

    it('maps boolean true to 1.0 and false to 0.0', () => {
      const r1 = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: true },
      ], lookup);
      expect(r1.mappings[0]!.confidence).toBe(1.0);

      const r2 = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: false },
      ], lookup);
      expect(r2.mappings[0]!.confidence).toBe(0.0);
    });

    it('defaults undefined/null to 0.50', () => {
      const result = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports' },
      ], lookup);
      expect(result.mappings[0]!.confidence).toBe(0.50);
    });

    it('handles NaN and Infinity', () => {
      const r1 = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: NaN },
      ], lookup);
      expect(r1.mappings[0]!.confidence).toBe(0.50);

      const r2 = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: Infinity },
      ], lookup);
      expect(r2.mappings[0]!.confidence).toBe(0.50);
    });

    it('parses numeric string "0.72"', () => {
      const result = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: '0.72' },
      ], lookup);
      expect(result.mappings[0]!.confidence).toBe(0.72);
    });

    it('parses percentage string "85" → 0.85', () => {
      const result = validateConceptMappings([
        { concept_id: 'affordance', relation: 'supports', confidence: '85' },
      ], lookup);
      expect(result.mappings[0]!.confidence).toBe(0.85);
    });
  });

  describe('concept_id existence check', () => {
    it('diverts unknown concept to suggestions', () => {
      const result = validateConceptMappings([
        { concept_id: 'unknown_concept', relation: 'supports', confidence: 0.8 },
      ], lookup);
      expect(result.mappings).toHaveLength(0);
      expect(result.divertedToSuggestions).toHaveLength(1);
      expect(result.divertedToSuggestions[0]!.concept_id).toBe('unknown_concept');
    });

    it('suggests closest concept via Levenshtein', () => {
      const result = validateConceptMappings([
        { concept_id: 'theoryof_mind', relation: 'supports', confidence: 0.8 },
      ], lookup);
      expect(result.warnings.some(w => w.includes('did you mean'))).toBe(true);
    });

    it('skips existence check when no lookup provided', () => {
      const result = validateConceptMappings([
        { concept_id: 'nonexistent', relation: 'supports', confidence: 0.8 },
      ]);
      expect(result.mappings).toHaveLength(1);
      expect(result.divertedToSuggestions).toHaveLength(0);
    });
  });

  describe('invalid entries', () => {
    it('skips null entries with warning', () => {
      const result = validateConceptMappings([null as any], lookup);
      expect(result.mappings).toHaveLength(0);
      expect(result.warnings).toContain('Skipped non-object mapping entry');
    });

    it('skips entries without concept_id', () => {
      const result = validateConceptMappings([{ relation: 'supports' }], lookup);
      expect(result.mappings).toHaveLength(0);
      expect(result.warnings).toContain('Missing concept_id in mapping');
    });
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns length for empty string', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('returns 1 for single character difference', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('returns correct distance for insertions needed', () => {
    expect(levenshteinDistance('abc', 'abcd')).toBe(1);
  });
});
