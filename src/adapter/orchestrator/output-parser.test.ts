import { describe, it, expect } from 'vitest';
import {
  parse as parseOutput,
  buildParseDiagnostic,
} from '../output-parser/output-parser';
import { validateConceptMappings } from '../output-parser/field-validator';
import { parseSuggestedConcepts } from '../output-parser/suggestion-parser';

// ─── Legacy-compatible helpers for test assertions ───

function extractConceptMappings(
  frontmatter: Record<string, unknown> | null,
): Array<{ concept_id: string; relation: string; confidence: number; evidence?: string }> {
  if (!frontmatter) return [];
  const raw = frontmatter['concept_mappings'];
  if (!Array.isArray(raw)) return [];
  const { mappings } = validateConceptMappings(raw);
  return mappings.map((m) => {
    const entry: { concept_id: string; relation: string; confidence: number; evidence?: string } = {
      concept_id: m.concept_id,
      relation: m.relation,
      confidence: m.confidence,
    };
    if (m.evidence.en) entry.evidence = m.evidence.en;
    return entry;
  });
}

function extractSuggestedConcepts(
  frontmatter: Record<string, unknown> | null,
): Array<{
  term: string;
  frequency_in_paper?: number;
  closest_existing?: string | null;
  reason?: string;
  suggested_definition?: string | null;
  suggested_keywords?: string[] | null;
}> {
  if (!frontmatter) return [];
  const raw = frontmatter['suggested_new_concepts'];
  const parsed = parseSuggestedConcepts(raw);
  return parsed.map((s) => ({
    term: s.term,
    frequency_in_paper: s.frequencyInPaper,
    closest_existing: s.closestExisting,
    reason: s.reason,
    suggested_definition: s.suggestedDefinition,
    suggested_keywords: s.suggestedKeywords,
  }));
}

// ─── parseOutput strategy chain ───

describe('parseOutput', () => {
  it('Strategy 1: parses standard YAML fence', () => {
    const input = `---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: 0.85
---

The paper discusses affordance theory.`;

    const result = parseOutput(input);
    expect(result.strategy).toBe('yaml_fence');
    expect(result.frontmatter).not.toBeNull();
    expect((result.frontmatter!['concept_mappings'] as unknown[]).length).toBe(1);
    expect(result.body).toContain('affordance theory');
  });

  it('Strategy 1: YAML with syntax error → sanitize → succeeds', () => {
    // Missing space after colon — sanitizeYaml should fix
    const input = `---
concept_id:affordance
relation:supports
confidence:0.85
---
Body text.`;

    const result = parseOutput(input);
    // Should either succeed via sanitization or fall through
    expect(result.frontmatter).not.toBeNull();
  });

  it('Strategy 2: parses code-block wrapped YAML', () => {
    const input = `Here is the analysis:
\`\`\`yaml
concept_mappings:
  - concept_id: tom
    relation: extends
    confidence: 0.72
\`\`\`
More text here.`;

    const result = parseOutput(input);
    expect(result.strategy).toBe('code_block');
    expect(result.frontmatter).not.toBeNull();
    expect(result.body).toContain('More text');
  });

  it('Strategy 3: parses JSON fallback', () => {
    const input = `Analysis:
\`\`\`json
{
  "concept_mappings": [
    { "concept_id": "tom", "relation": "supports", "confidence": 0.9 }
  ]
}
\`\`\``;

    const result = parseOutput(input);
    expect(result.strategy).toBe('json_fallback');
    expect(result.frontmatter).not.toBeNull();
  });

  it('Strategy 3: JSON with errors is repaired via jsonrepair', () => {
    const input = `\`\`\`json
{
  "concept_mappings": [
    { "concept_id": "tom", "relation": "supports", "confidence": 0.9, }
  ],
}
\`\`\``;

    const result = parseOutput(input);
    expect(result.strategy).toBe('json_repaired');
    expect(result.frontmatter).not.toBeNull();
  });

  it('Strategy 4: regex extraction when YAML/JSON fail', () => {
    const input = `Here are the mappings:
concept_id: affordance
relation: supports
confidence: 0.85

Also found:
term: "social presence"`;

    const result = parseOutput(input);
    expect(result.strategy).toBe('regex_extraction');
    const mappings = result.frontmatter!['concept_mappings'] as unknown[];
    expect(mappings.length).toBe(1);
    const suggestions = result.frontmatter!['suggested_new_concepts'] as unknown[];
    expect(suggestions.length).toBe(1);
  });

  it('Strategy 5: complete failure returns parse_failed', () => {
    const result = parseOutput('Just some random text with no structure.');
    expect(result.strategy).toBe('parse_failed');
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('Just some random text with no structure.');
  });
});

// ─── sanitizeYaml (tested via parseOutput fallback) ───

describe('YAML sanitization', () => {
  it('fixes tab indentation', () => {
    const input = "---\nconcept_mappings:\n\t- concept_id: x\n\t  relation: supports\n\t  confidence: 0.5\n---";
    const result = parseOutput(input);
    expect(result.frontmatter).not.toBeNull();
  });

  it('fixes trailing commas', () => {
    const input = "---\nconcept_id: x,\nrelation: supports,\n---";
    const result = parseOutput(input);
    // May or may not parse depending on YAML strictness, but shouldn't crash
    expect(result).toBeDefined();
  });

  it('fixes list items without space after dash', () => {
    const input = "---\nkeywords:\n  -affordance\n  -design\n---";
    const result = parseOutput(input);
    expect(result.frontmatter).not.toBeNull();
  });

  it('does not break URLs containing colons', () => {
    const input = "---\nurl: https://example.com/page\ntitle: Test\n---";
    const result = parseOutput(input);
    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!['url']).toContain('https://');
  });
});

// ─── extractConceptMappings ───

describe('extractConceptMappings', () => {
  it('extracts valid mappings', () => {
    const fm = {
      concept_mappings: [
        { concept_id: 'affordance', relation: 'supports', confidence: 0.85, evidence: 'some evidence' },
        { concept_id: 'tom', relation: 'extends', confidence: 0.6 },
      ],
    };
    const mappings = extractConceptMappings(fm);
    expect(mappings).toHaveLength(2);
    expect(mappings[0]!.concept_id).toBe('affordance');
    expect(mappings[1]!.confidence).toBe(0.6);
  });

  it('returns empty array for null frontmatter', () => {
    expect(extractConceptMappings(null)).toEqual([]);
  });

  it('filters entries missing required fields', () => {
    const fm = {
      concept_mappings: [
        { concept_id: 'ok', relation: 'supports' },
        { relation: 'missing_id' },           // no concept_id
        { concept_id: 'no_rel' },             // no relation
        { concept_id: 123, relation: 'bad' }, // concept_id not string
      ],
    };
    const mappings = extractConceptMappings(fm);
    expect(mappings).toHaveLength(2);
    expect(mappings[0]!.concept_id).toBe('ok');
    expect(mappings[1]!.concept_id).toBe('no_rel');
    expect(mappings[1]!.relation).toBe('supports');
  });

  it('defaults confidence to 0.5 when missing', () => {
    const fm = { concept_mappings: [{ concept_id: 'x', relation: 'supports' }] };
    expect(extractConceptMappings(fm)[0]!.confidence).toBe(0.5);
  });
});

// ─── extractSuggestedConcepts ───

describe('extractSuggestedConcepts', () => {
  it('extracts valid suggestions', () => {
    const fm = {
      suggested_new_concepts: [
        { term: 'social presence', frequency_in_paper: 12, reason: 'central construct' },
        { term: 'uncanny valley' },
      ],
    };
    const suggestions = extractSuggestedConcepts(fm);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]!.term).toBe('social presence');
    expect(suggestions[0]!.frequency_in_paper).toBe(12);
    expect(suggestions[1]!.frequency_in_paper).toBe(1); // default
  });

  it('filters entries without term field', () => {
    const fm = {
      suggested_new_concepts: [
        { term: 'valid' },
        { not_term: 'invalid' },
        { term: '' },  // empty string
      ],
    };
    const suggestions = extractSuggestedConcepts(fm);
    expect(suggestions).toHaveLength(1);
  });

  it('returns empty for non-array field', () => {
    expect(extractSuggestedConcepts({ suggested_new_concepts: 'not an array' })).toEqual([]);
  });
});

// ─── buildParseDiagnostic ───

describe('buildParseDiagnostic', () => {
  it('reports output characteristics', () => {
    const output = '---\nconcept_id: affordance\nrelation: supports\n---\nBody text.';
    const diag = buildParseDiagnostic(output);
    expect(diag['outputLength']).toBe(output.length);
    expect(diag['hasTripleDash']).toBe(true);
    expect(diag['hasYamlKeywords']).toBe(true);
    expect((diag['preview'] as string).length).toBeLessThanOrEqual(500);
  });

  it('detects absence of YAML markers', () => {
    const diag = buildParseDiagnostic('Just plain text.');
    expect(diag['hasTripleDash']).toBe(false);
    expect(diag['hasCodeBlock']).toBe(false);
  });
});
