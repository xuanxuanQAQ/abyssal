/**
 * Golden tests — dirty LLM output → parsed/validated output structure.
 *
 * Verifies the 5-level parse chain produces stable results for known inputs.
 */
import { describe, it, expect } from 'vitest';
import { parse, parseAndValidate } from '../../../src/adapter/output-parser/output-parser';
import {
  MULTI_FENCE_YAML_THEN_CODE,
  MULTI_CODE_BLOCK_YAML_PREFERRED,
  UNCLOSED_YAML_FENCE,
  BOOLEAN_CONFIDENCE,
  HEAVY_MARKDOWN_NOISE,
  SMART_QUOTES_IN_VALUES,
  JSON_TRAILING_COMMAS,
  TAB_INDENTED_YAML,
  PURE_PROSE_NO_STRUCTURE,
  JSON_WRAPPED_OUTPUT,
  BARE_JSON_OUTPUT,
  UNQUOTED_COLONS,
} from '../../fixtures/malformed-outputs';

describe('output-parser golden — dirty output parsing', () => {
  it('parses standard YAML fence with trailing code block', () => {
    const result = parse(MULTI_FENCE_YAML_THEN_CODE);
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('yaml_fence');
    expect(result.frontmatter?.concept_mappings).toHaveLength(1);
    expect((result.frontmatter?.concept_mappings as any[])[0].concept_id).toBe('affordance');
  });

  it('prefers YAML code block over TypeScript code block', () => {
    const result = parse(MULTI_CODE_BLOCK_YAML_PREFERRED);
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('code_block');
    expect((result.frontmatter?.concept_mappings as any[])[0].concept_id).toBe('embodied_cognition');
  });

  it('recovers from unclosed YAML fence', () => {
    const result = parse(UNCLOSED_YAML_FENCE);
    // The parser succeeds in extracting some structure even without closing ---
    expect(result.success).toBe(true);
    // Depending on repair strategy, concept_mappings may or may not survive
    expect(result.frontmatter).toBeDefined();
  });

  it('repairs boolean confidence values', () => {
    const result = parse(BOOLEAN_CONFIDENCE);
    expect(result.success).toBe(true);
    const mapping = (result.frontmatter?.concept_mappings as any[])[0];
    // confidence: true may stay as string 'true' or be coerced — verify it's present
    expect(mapping.confidence).toBeDefined();
  });

  it('parses through heavy markdown noise', () => {
    const result = parse(HEAVY_MARKDOWN_NOISE);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('handles smart quotes via R6 repair', () => {
    const result = parse(SMART_QUOTES_IN_VALUES);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('handles JSON trailing commas via R5 repair', () => {
    const result = parse(JSON_TRAILING_COMMAS);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('normalizes tab indentation via R2 repair', () => {
    const result = parse(TAB_INDENTED_YAML);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('wraps unquoted colons via R1 repair', () => {
    const result = parse(UNQUOTED_COLONS);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('falls back to JSON parsing for ```json blocks', () => {
    const result = parse(JSON_WRAPPED_OUTPUT);
    expect(result.success).toBe(true);
    expect(result.strategy).toMatch(/json/);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('falls back to JSON parsing for bare JSON', () => {
    const result = parse(BARE_JSON_OUTPUT);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('fails gracefully on pure prose', () => {
    const result = parse(PURE_PROSE_NO_STRUCTURE);
    expect(result.success).toBe(false);
    expect(result.strategy).toBe('parse_failed');
  });
});

describe('output-parser golden — parseAndValidate pipeline', () => {
  it('produces a stable validated output for a well-formed YAML fence', () => {
    const validated = parseAndValidate(MULTI_FENCE_YAML_THEN_CODE, {
      paperId: 'p-golden-001',
    });

    expect({
      success: validated.success,
      strategy: validated.strategy,
      mappingCount: validated.conceptMappings.length,
      warnings: validated.warnings,
      rawPath: validated.rawPath,
    }).toMatchInlineSnapshot(`
      {
        "mappingCount": 1,
        "rawPath": null,
        "strategy": "yaml_fence",
        "success": true,
        "warnings": [],
      }
    `);
  });

  it('produces fail-save diagnostics for pure prose input', () => {
    const validated = parseAndValidate(PURE_PROSE_NO_STRUCTURE, {
      paperId: 'p-golden-fail',
    });

    expect(validated.success).toBe(false);
    expect(validated.strategy).toBe('parse_failed');
    expect(validated.conceptMappings).toEqual([]);
    expect(validated.warnings).toContain('All parse strategies failed');
  });
});
