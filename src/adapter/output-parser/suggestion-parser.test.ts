import { parseSuggestedConcepts, type SuggestionParseContext } from './suggestion-parser';

describe('parseSuggestedConcepts', () => {
  describe('basic parsing', () => {
    it('returns empty for non-array input', () => {
      expect(parseSuggestedConcepts(null)).toEqual([]);
      expect(parseSuggestedConcepts('not an array')).toEqual([]);
      expect(parseSuggestedConcepts(42)).toEqual([]);
    });

    it('returns empty for empty array', () => {
      expect(parseSuggestedConcepts([])).toEqual([]);
    });

    it('parses a valid suggestion', () => {
      const result = parseSuggestedConcepts([{
        term: 'cognitive load',
        frequency_in_paper: 7,
        closest_existing: null,
        reason: 'Appears in multiple sections',
      }]);

      expect(result).toHaveLength(1);
      expect(result[0]!.term).toBe('cognitive load');
      expect(result[0]!.termNormalized).toBe('cognitive load');
      expect(result[0]!.frequencyInPaper).toBe(7);
      expect(result[0]!.reason).toBe('Appears in multiple sections');
    });
  });

  describe('deduplication', () => {
    it('deduplicates by normalized term (case-insensitive)', () => {
      const result = parseSuggestedConcepts([
        { term: 'Cognitive Load' },
        { term: 'cognitive load' },
        { term: 'COGNITIVE LOAD' },
      ]);
      expect(result).toHaveLength(1);
    });
  });

  describe('field normalization', () => {
    it('trims whitespace from term', () => {
      const result = parseSuggestedConcepts([{ term: '  spatial cognition  ' }]);
      expect(result[0]!.term).toBe('spatial cognition');
    });

    it('uses alternate frequency field names', () => {
      const result = parseSuggestedConcepts([{ term: 'foo', frequency: 5 }]);
      expect(result[0]!.frequencyInPaper).toBe(5);
    });

    it('clamps frequency to [1, 9999]', () => {
      const r1 = parseSuggestedConcepts([{ term: 'foo', frequency_in_paper: 0 }]);
      expect(r1[0]!.frequencyInPaper).toBe(1);

      const r2 = parseSuggestedConcepts([{ term: 'bar', frequency_in_paper: 99999 }]);
      expect(r2[0]!.frequencyInPaper).toBe(9999);
    });

    it('truncates reason to 500 chars', () => {
      const longReason = 'x'.repeat(600);
      const result = parseSuggestedConcepts([{ term: 'foo', reason: longReason }]);
      expect(result[0]!.reason.length).toBeLessThanOrEqual(503); // 500 + "..."
    });
  });

  describe('zero-concept mode fields', () => {
    it('parses suggested_definition', () => {
      const result = parseSuggestedConcepts([{
        term: 'foo', suggested_definition: 'A concept about foo',
      }]);
      expect(result[0]!.suggestedDefinition).toBe('A concept about foo');
    });

    it('falls back to definition field', () => {
      const result = parseSuggestedConcepts([{
        term: 'foo', definition: 'Alt definition',
      }]);
      expect(result[0]!.suggestedDefinition).toBe('Alt definition');
    });

    it('parses suggested_keywords from array', () => {
      const result = parseSuggestedConcepts([{
        term: 'foo', suggested_keywords: ['key1', 'key2'],
      }]);
      expect(result[0]!.suggestedKeywords).toEqual(['key1', 'key2']);
    });

    it('parses suggested_keywords from comma-separated string', () => {
      const result = parseSuggestedConcepts([{
        term: 'foo', suggested_keywords: 'key1, key2, key3',
      }]);
      expect(result[0]!.suggestedKeywords).toEqual(['key1', 'key2', 'key3']);
    });

    it('limits keywords to 10', () => {
      const keywords = Array.from({ length: 15 }, (_, i) => `kw${i}`);
      const result = parseSuggestedConcepts([{
        term: 'foo', suggested_keywords: keywords,
      }]);
      expect(result[0]!.suggestedKeywords).toHaveLength(10);
    });
  });

  describe('closest_existing resolution', () => {
    const context: SuggestionParseContext = {
      knownConceptIds: new Set(['theory_of_mind', 'affordance']),
      getConceptName: (id) => {
        const names: Record<string, string> = { theory_of_mind: 'Theory of Mind', affordance: 'Affordance' };
        return names[id] ?? null;
      },
    };

    it('resolves exact ID match', () => {
      const result = parseSuggestedConcepts([{
        term: 'foo', closest_existing: 'theory_of_mind',
      }], context);
      expect(result[0]!.closestExisting).toBe('theory_of_mind');
    });

    it('resolves by concept name (case-insensitive)', () => {
      const result = parseSuggestedConcepts([{
        term: 'foo', closest_existing: 'theory of mind',
      }], context);
      expect(result[0]!.closestExisting).toBe('theory_of_mind');
    });

    it('returns null for no match', () => {
      const result = parseSuggestedConcepts([{
        term: 'foo', closest_existing: 'nonexistent',
      }], context);
      expect(result[0]!.closestExisting).toBeNull();
    });
  });

  describe('skip invalid entries', () => {
    it('skips null entries', () => {
      expect(parseSuggestedConcepts([null])).toEqual([]);
    });

    it('skips entries without term', () => {
      expect(parseSuggestedConcepts([{ reason: 'no term' }])).toEqual([]);
    });

    it('skips entries with empty term', () => {
      expect(parseSuggestedConcepts([{ term: '   ' }])).toEqual([]);
    });

    it('skips non-string term', () => {
      expect(parseSuggestedConcepts([{ term: 42 }])).toEqual([]);
    });
  });
});
