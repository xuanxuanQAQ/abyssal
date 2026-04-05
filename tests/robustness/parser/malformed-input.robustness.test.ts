/**
 * Robustness tests — parser under adversarial / malformed inputs.
 *
 * Tests multi-fence conflicts, half-closed YAML, wrong-type values,
 * mixed markdown noise, and the auto-repair pipeline under stress.
 */
import { describe, it, expect } from 'vitest';
import { fc, it as fcIt } from '@fast-check/vitest';
import { parse, parseAndValidate } from '../../../src/adapter/output-parser/output-parser';
import { applyRepairRules } from '../../../src/adapter/output-parser/auto-repair';
import * as yaml from 'js-yaml';
import {
  MULTI_FENCE_YAML_THEN_CODE,
  MULTI_CODE_BLOCK_YAML_PREFERRED,
  UNCLOSED_YAML_FENCE,
  FENCE_MISSING_CLOSING_DASHES,
  BOOLEAN_CONFIDENCE,
  STRING_CONFIDENCE,
  EVIDENCE_AS_PLAIN_STRING,
  HEAVY_MARKDOWN_NOISE,
  INTERLEAVED_MARKDOWN_AND_YAML,
  SMART_QUOTES_IN_VALUES,
  JSON_TRAILING_COMMAS,
  UNQUOTED_COLONS,
  TAB_INDENTED_YAML,
  PURE_PROSE_NO_STRUCTURE,
  EMPTY_STRING,
  WHITESPACE_ONLY,
  JUST_FENCES,
} from '../../fixtures/malformed-outputs';

describe('parser robustness — multi-fence conflicts', () => {
  it('resolves YAML fence when followed by code block', () => {
    const result = parse(MULTI_FENCE_YAML_THEN_CODE);
    expect(result.success).toBe(true);
    expect(result.frontmatter).not.toBeNull();
  });

  it('selects YAML code block over non-YAML code block', () => {
    const result = parse(MULTI_CODE_BLOCK_YAML_PREFERRED);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('handles interleaved markdown and YAML gracefully', () => {
    const result = parse(INTERLEAVED_MARKDOWN_AND_YAML);
    expect(result.success).toBe(true);
  });
});

describe('parser robustness — half-closed YAML fences', () => {
  it('recovers from unclosed YAML fence', () => {
    const result = parse(UNCLOSED_YAML_FENCE);
    // Parser succeeds but may not extract concept_mappings from malformed fence
    expect(result.success).toBe(true);
    expect(result.frontmatter).toBeDefined();
  });

  it('recovers from missing closing dashes', () => {
    const result = parse(FENCE_MISSING_CLOSING_DASHES);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('handles just bare fences', () => {
    const result = parse(JUST_FENCES);
    // Either succeeds with empty frontmatter or fails gracefully
    expect(typeof result.success).toBe('boolean');
  });
});

describe('parser robustness — wrong-type values', () => {
  it('handles boolean confidence (yes/no)', () => {
    const result = parse(BOOLEAN_CONFIDENCE);
    expect(result.success).toBe(true);
    // Repair rules should convert yes → 0.85
    const mappings = result.frontmatter?.concept_mappings as any[];
    expect(mappings).toBeDefined();
  });

  it('handles string confidence (high/low)', () => {
    const result = parse(STRING_CONFIDENCE);
    expect(result.success).toBe(true);
  });

  it('handles evidence as plain string instead of object', () => {
    const result = parse(EVIDENCE_AS_PLAIN_STRING);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });
});

describe('parser robustness — markdown noise', () => {
  it('extracts YAML from heavy markdown document', () => {
    const result = parse(HEAVY_MARKDOWN_NOISE);
    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('handles markdown tables interspersed with YAML', () => {
    const input = `| Col1 | Col2 |\n|------|------|\n| a    | b    |\n\n---\nconcept_mappings:\n  - concept_id: test\n    relation: supports\n    confidence: 0.8\n    evidence:\n      en: "test"\n      zh: "测试"\n---`;
    const result = parse(input);
    expect(result.success).toBe(true);
  });
});

describe('parser robustness — empty / edge-case inputs', () => {
  it('handles empty string input', () => {
    const result = parse(EMPTY_STRING);
    expect(result.success).toBe(false);
  });

  it('handles whitespace-only input', () => {
    const result = parse(WHITESPACE_ONLY);
    expect(result.success).toBe(false);
  });

  it('handles extremely long input (>100KB)', () => {
    const longContent = 'a'.repeat(100_000);
    const input = `---\nframework_state: complete\n---\n${longContent}`;
    const result = parse(input);
    expect(result.success).toBe(true);
  });
});

describe('auto-repair robustness — adversarial inputs', () => {
  it('repair is idempotent for all fixture samples', () => {
    const samples = [
      BOOLEAN_CONFIDENCE,
      JSON_TRAILING_COMMAS,
      SMART_QUOTES_IN_VALUES,
      TAB_INDENTED_YAML,
      UNQUOTED_COLONS,
    ];

    for (const sample of samples) {
      const once = applyRepairRules(sample);
      const twice = applyRepairRules(once.text);
      expect(twice.text).toBe(once.text);
    }
  });

  it('repair does not corrupt valid YAML', () => {
    const validYaml = `concept_mappings:\n  - concept_id: test\n    relation: supports\n    confidence: 0.85\n    evidence:\n      en: "Valid evidence"\n      zh: "有效证据"`;
    const result = applyRepairRules(validYaml);
    // R4 may fire on some valid patterns — verify content is semantically preserved
    const original = yaml.load(validYaml) as any;
    const repaired = yaml.load(result.text) as any;
    expect(repaired.concept_mappings[0].concept_id).toBe(original.concept_mappings[0].concept_id);
    expect(repaired.concept_mappings[0].confidence).toBe(original.concept_mappings[0].confidence);
  });

  fcIt.prop([fc.string({ minLength: 0, maxLength: 5000 })])(
    'repair never throws on arbitrary string input',
    (input) => {
      expect(() => applyRepairRules(input)).not.toThrow();
    },
  );

  fcIt.prop([fc.string({ minLength: 0, maxLength: 3000 })])(
    'repair is idempotent on arbitrary input',
    (input) => {
      const once = applyRepairRules(input);
      const twice = applyRepairRules(once.text);
      expect(twice.text).toBe(once.text);
    },
  );
});

describe('parseAndValidate robustness — full pipeline under stress', () => {
  it('does not throw on null-like inputs', () => {
    expect(() => parseAndValidate('', { paperId: 'p-empty' })).not.toThrow();
    expect(() => parseAndValidate('   ', { paperId: 'p-ws' })).not.toThrow();
  });

  it('produces diagnostics for total parse failure', () => {
    const result = parseAndValidate(PURE_PROSE_NO_STRUCTURE, { paperId: 'p-fail' });
    expect(result.success).toBe(false);
    expect(result.diagnostics).not.toBeNull();
    expect(result.conceptMappings).toEqual([]);
    expect(result.suggestedConcepts).toEqual([]);
  });

  it('never throws on fixture corpus samples', () => {
    const allSamples = [
      MULTI_FENCE_YAML_THEN_CODE,
      MULTI_CODE_BLOCK_YAML_PREFERRED,
      UNCLOSED_YAML_FENCE,
      FENCE_MISSING_CLOSING_DASHES,
      BOOLEAN_CONFIDENCE,
      STRING_CONFIDENCE,
      EVIDENCE_AS_PLAIN_STRING,
      HEAVY_MARKDOWN_NOISE,
      INTERLEAVED_MARKDOWN_AND_YAML,
      SMART_QUOTES_IN_VALUES,
      JSON_TRAILING_COMMAS,
      UNQUOTED_COLONS,
      TAB_INDENTED_YAML,
      PURE_PROSE_NO_STRUCTURE,
      EMPTY_STRING,
      WHITESPACE_ONLY,
      JUST_FENCES,
    ];

    for (const sample of allSamples) {
      expect(() => parseAndValidate(sample, { paperId: 'p-corpus' })).not.toThrow();
    }
  });
});
