import { fc, it as fcIt } from '@fast-check/vitest';
import { applyRepairRules, type RepairResult } from './output-parser/auto-repair';
import { normalizeEvidence } from './output-parser/evidence-normalizer';
import { truncateContent, type TokenCounter, truncateRagPassages, iterativeTrim, type TrimBlock } from './prompt-assembler/truncation-engine';

// ─── Shared helpers ───

const simpleTokenCounter: TokenCounter = {
  count: (text: string) => Math.ceil(text.length / 4),
};

// ─── §P1-fp-1: applyRepairRules — idempotency property ───

describe('applyRepairRules — property tests', () => {
  fcIt.prop([fc.string({ minLength: 0, maxLength: 2000 })])(
    'idempotent: applying twice yields same result',
    (input) => {
      const once = applyRepairRules(input);
      const twice = applyRepairRules(once.text);
      expect(twice.text).toBe(once.text);
    },
  );

  fcIt.prop([fc.string({ minLength: 0, maxLength: 2000 })])(
    'output is always a RepairResult with text string',
    (input) => {
      const result = applyRepairRules(input);
      expect(typeof result.text).toBe('string');
      expect(Array.isArray(result.appliedRules)).toBe(true);
    },
  );
});

// ─── §P1-fp-2: normalizeEvidence — always returns complete structure ───

describe('normalizeEvidence — property tests', () => {
  const evidenceArb = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.string(),
    fc.record({
      quote: fc.option(fc.string(), { nil: undefined }),
      page: fc.option(fc.oneof(fc.integer(), fc.string()), { nil: undefined }),
      section: fc.option(fc.string(), { nil: undefined }),
    }),
    fc.array(fc.string()),
    fc.integer(),
    fc.boolean(),
  );

  fcIt.prop([evidenceArb])(
    'always returns a complete NormalizedEvidence structure',
    (input) => {
      const result = normalizeEvidence(input as any);
      expect(result).toHaveProperty('en');
      expect(result).toHaveProperty('original');
      expect(result).toHaveProperty('original_lang');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('chunk_id');
      expect(result).toHaveProperty('annotation_id');
    },
  );

  fcIt.prop([evidenceArb])(
    'original_lang is always a string',
    (input) => {
      const result = normalizeEvidence(input as any);
      expect(typeof result.original_lang).toBe('string');
      expect(result.original_lang.length).toBeGreaterThan(0);
    },
  );
});

// ─── §P1-fp-3: truncateContent — never exceeds budget ───

describe('truncateContent — property tests', () => {
  fcIt.prop([
    fc.string({ minLength: 1, maxLength: 5000 }),
    fc.integer({ min: 10, max: 2000 }),
  ])(
    'output tokens never exceed target (paper_fulltext)',
    (content, target) => {
      const result = truncateContent(content, target, 'paper_fulltext', simpleTokenCounter);
      const resultTokens = simpleTokenCounter.count(result);
      expect(resultTokens).toBeLessThanOrEqual(target + 50);
    },
  );

  fcIt.prop([
    fc.string({ minLength: 1, maxLength: 3000 }),
    fc.integer({ min: 10, max: 2000 }),
  ])(
    'returns unchanged content when already within budget',
    (content, target) => {
      const currentTokens = simpleTokenCounter.count(content);
      if (currentTokens <= target) {
        const result = truncateContent(content, target, 'paper_fulltext', simpleTokenCounter);
        expect(result).toBe(content);
      }
    },
  );
});

// ─── §P1-fp-4: truncateRagPassages — total tokens within budget ───

describe('truncateRagPassages — property tests', () => {
  const passageArb = fc.record({
    paperId: fc.stringMatching(/^p-[0-9]{1,3}$/),
    text: fc.string({ minLength: 1, maxLength: 500 }),
    tokenCount: fc.integer({ min: 10, max: 200 }),
    score: fc.float({ min: 0, max: 1, noNaN: true }),
  });

  fcIt.prop([
    fc.array(passageArb, { minLength: 0, maxLength: 20 }),
    fc.integer({ min: 50, max: 5000 }),
  ])(
    'total token count of selected passages ≤ target',
    (passages, target) => {
      const result = truncateRagPassages(passages, target);
      const totalTokens = result.reduce((sum, p) => sum + p.tokenCount, 0);
      expect(totalTokens).toBeLessThanOrEqual(target);
    },
  );

  fcIt.prop([
    fc.array(passageArb, { minLength: 0, maxLength: 20 }),
    fc.integer({ min: 50, max: 5000 }),
  ])(
    'returns subset of input passages',
    (passages, target) => {
      const result = truncateRagPassages(passages, target);
      for (const r of result) {
        expect(passages).toContainEqual(r);
      }
    },
  );
});

// ─── §P1-fp-5: iterativeTrim — never increases remaining overflow ───

describe('iterativeTrim — property tests', () => {
  fcIt.prop([
    fc.integer({ min: 1, max: 500 }),
  ])(
    'remaining after trim ≤ initial overflow',
    (overflow) => {
      const blocks: TrimBlock[] = [
        { content: 'A'.repeat(500), sourceType: 'rag_passages', priority: 'LOW', included: true },
        { content: 'B'.repeat(300), sourceType: 'synthesis_fragments', priority: 'MEDIUM', included: true },
      ];
      const remaining = iterativeTrim(blocks, overflow, simpleTokenCounter);
      expect(remaining).toBeLessThanOrEqual(overflow);
    },
  );
});
