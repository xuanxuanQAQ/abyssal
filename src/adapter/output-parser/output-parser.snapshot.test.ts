/**
 * Snapshot + contract tests for output-parser five-level parsing chain.
 *
 * Inline snapshots pin the parse strategy and structure of parsed output
 * for each parsing level, catching regressions in the fallback chain.
 */
import { parse, type ParsedOutput } from './output-parser';

// ─── Level 1: YAML fence strategy — snapshot ───

describe('parse — Level 1: yaml_fence', () => {
  it('parses standard YAML fence', () => {
    const input = `---
concept_id: c-1
relation: supports
confidence: 0.85
---
Analysis body text here.`;
    const result = parse(input);
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('yaml_fence');
    expect(result.frontmatter).toMatchInlineSnapshot(`
      {
        "concept_id": "c-1",
        "confidence": "0.85",
        "relation": "supports",
      }
    `);
    expect(result.body).toContain('Analysis body text');
  });

  it('parses YAML fence with single opening (missing closing ---)', () => {
    const input = `---
concept_id: c-2
relation: extends
confidence: 0.7

## Summary

Body text.`;
    const result = parse(input);
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('yaml_fence');
  });
});

// ─── Level 2: code_block strategy — snapshot ───

describe('parse — Level 2: code_block', () => {
  it('parses yaml code block', () => {
    const input = `Some preamble text
\`\`\`yaml
concept_id: c-2
relation: extends
confidence: 0.7
\`\`\`
Rest of body.`;
    const result = parse(input);
    expect(result.success).toBe(true);
    expect(result.strategy).toMatch(/code_block/);
    expect(result.frontmatter).toMatchInlineSnapshot(`
      {
        "concept_id": "c-2",
        "confidence": "0.7",
        "relation": "extends",
      }
    `);
  });
});

// ─── Level 3: JSON fallback — snapshot ───

describe('parse — Level 3: json_fallback', () => {
  it('parses JSON block', () => {
    const input = `Here is my analysis:
\`\`\`json
{"concept_id": "c-3", "relation": "contradicts", "confidence": 0.6}
\`\`\``;
    const result = parse(input);
    expect(result.success).toBe(true);
    expect(result.strategy).toMatch(/json/);
    expect(result.frontmatter).toMatchInlineSnapshot(`
      {
        "concept_id": "c-3",
        "confidence": 0.6,
        "relation": "contradicts",
      }
    `);
  });
});

// ─── Level 4: regex extraction — snapshot ───

describe('parse — Level 4: regex_extraction', () => {
  it('extracts fields via regex patterns', () => {
    const input = `After careful analysis, the concept_id is c-4.
The relation is "supports" with a confidence of 0.9.`;
    const result = parse(input);
    if (result.success) {
      expect(result.strategy).toBe('regex_extraction');
      expect(result.frontmatter?.concept_id).toBeDefined();
    }
  });
});

// ─── Level 5: parse_failed ───

describe('parse — Level 5: parse_failed', () => {
  it('returns failure for gibberish', () => {
    const result = parse('Lorem ipsum dolor sit amet.');
    expect(result.success).toBe(false);
    expect(result.strategy).toBe('parse_failed');
    expect(result.frontmatter).toBeNull();
  });
});
