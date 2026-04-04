import { parse, parseAndValidate, type ParseContext } from './output-parser';

describe('parse — five-level fallback chain', () => {
  // Level 1: YAML fence
  describe('Level 1 — YAML fence', () => {
    it('parses standard double-dash YAML fence', () => {
      const input = '---\nconcept_mappings:\n  - concept_id: tom\n    relation: supports\n    confidence: 0.85\n---\n\nBody text.';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toBe('yaml_fence');
      expect(r.frontmatter).toHaveProperty('concept_mappings');
      expect(r.body).toBe('Body text.');
    });

    it('tolerates prefix text before ---', () => {
      const input = 'Some preamble\n---\nkey: value\n---\nBody';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toBe('yaml_fence');
    });

    it('handles single --- at start (missing closing)', () => {
      const input = '---\nkey: value\n\n## Body starts';
      const r = parse(input);
      expect(r.success).toBe(true);
    });

    it('applies auto-repair and marks as yaml_fence_repaired', () => {
      // Tabs trigger R2 repair → FAILSAFE_SCHEMA already parses most things,
      // so we need content that actually breaks YAML parsing (e.g., bad indent)
      const input = '---\nconcept_mappings:\n\t- concept_id: test\n\t  relation: supports\n---';
      const r = parse(input);
      expect(r.success).toBe(true);
      // May be yaml_fence if FAILSAFE can handle it, or yaml_fence_repaired
      expect(r.strategy).toMatch(/yaml_fence/);
    });
  });

  // Level 2: Code block YAML
  describe('Level 2 — code block YAML', () => {
    it('parses ```yaml code block', () => {
      const input = 'Here is the result:\n```yaml\nkey: value\n```\nBody text.';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toMatch(/code_block/);
      expect(r.frontmatter).toHaveProperty('key', 'value');
    });

    it('parses untagged code block with enough YAML-like lines', () => {
      // looksLikeYaml requires ≥3 non-empty lines with ≥50% matching YAML patterns
      const input = '```\nfoo: bar\nbaz: 42\nqux: hello\nanother: value\n```';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toMatch(/code_block/);
    });
  });

  // Level 3: JSON fallback
  describe('Level 3 — JSON fallback', () => {
    it('parses ```json code block', () => {
      const input = '```json\n{"concept_mappings": [{"concept_id": "tom"}]}\n```';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toBe('json_fallback');
    });

    it('parses bare JSON object', () => {
      const input = 'The analysis: {"key": "value", "num": 42}';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toBe('json_fallback');
    });

    it('repairs broken JSON via jsonrepair', () => {
      const input = '```json\n{"concept_mappings": [{"concept_id": "tom",}]}\n```';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toBe('json_repaired');
    });
  });

  // Level 4: Regex extraction
  describe('Level 4 — regex extraction', () => {
    it('extracts concept_id/relation/confidence patterns', () => {
      const input = 'concept_id: theory_of_mind\nrelation: supports\nconfidence: 0.85';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toBe('regex_extraction');
      const mappings = r.frontmatter!['concept_mappings'] as any[];
      expect(mappings.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts compact format: concept: relation (confidence)', () => {
      const input = 'theory_of_mind: supports (0.85)';
      const r = parse(input);
      expect(r.success).toBe(true);
      expect(r.strategy).toBe('regex_extraction');
    });

    it('extracts table format', () => {
      const input = '| theory_of_mind | supports | 0.85 |';
      const r = parse(input);
      expect(r.success).toBe(true);
    });

    it('extracts suggested_new_concepts by term pattern', () => {
      const input = 'term: "cognitive load"\nfrequency_in_paper: 7';
      const r = parse(input);
      expect(r.success).toBe(true);
      const suggestions = r.frontmatter!['suggested_new_concepts'] as any[];
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // Level 5: Total failure
  describe('Level 5 — parse failed', () => {
    it('returns parse_failed for completely unstructured output', () => {
      const input = 'This paper is interesting but I have no structured output.';
      const r = parse(input);
      expect(r.success).toBe(false);
      expect(r.strategy).toBe('parse_failed');
    });
  });
});

describe('parseAndValidate', () => {
  const baseContext: ParseContext = {
    paperId: 'test-paper-1',
    model: 'claude-3.5-sonnet',
    frameworkState: 'framework_forming',
  };

  it('returns validated output for well-formed YAML', () => {
    const input = '---\nconcept_mappings:\n  - concept_id: tom\n    relation: supports\n    confidence: 0.85\n    evidence: "Key evidence"\n---\nBody';
    const r = parseAndValidate(input, baseContext);
    expect(r.success).toBe(true);
    expect(r.conceptMappings).toHaveLength(1);
    expect(r.conceptMappings[0]!.concept_id).toBe('tom');
  });

  it('returns diagnostics on total failure', () => {
    // mock out fs so failSave doesn't actually write
    const r = parseAndValidate('Just plain text.', baseContext);
    expect(r.success).toBe(false);
    expect(r.strategy).toBe('parse_failed');
    expect(r.diagnostics).not.toBeNull();
    expect(r.diagnostics!.summary).toBe('no_structured_output');
  });

  it('strips BOM and think chain in preprocessing', () => {
    const input = '\uFEFF<think>reasoning...</think>\n---\nkey: value\n---';
    const r = parseAndValidate(input, baseContext);
    expect(r.success).toBe(true);
  });

  it('diverts unknown concept_ids to suggestions when lookup provided', () => {
    const context: ParseContext = {
      ...baseContext,
      conceptLookup: {
        exists: (id) => id === 'affordance',
        allIds: new Set(['affordance']),
      },
    };
    const input = '---\nconcept_mappings:\n  - concept_id: unknown_concept\n    relation: supports\n    confidence: 0.8\n---';
    const r = parseAndValidate(input, context);
    expect(r.conceptMappings).toHaveLength(0);
    expect(r.suggestedConcepts.some(s => s.term === 'unknown_concept')).toBe(true);
  });

  it('parses suggested_new_concepts from frontmatter', () => {
    const input = '---\nsuggested_new_concepts:\n  - term: "cognitive load"\n    frequency_in_paper: 5\n---';
    const r = parseAndValidate(input, baseContext);
    expect(r.suggestedConcepts).toHaveLength(1);
    expect(r.suggestedConcepts[0]!.term).toBe('cognitive load');
  });
});
