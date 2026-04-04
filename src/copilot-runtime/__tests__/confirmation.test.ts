import { ConfirmationEvaluator } from '../confirmation';
import { makeOperation, resetSeq } from './helpers';
import type { OutputTarget } from '../types';

describe('ConfirmationEvaluator', () => {
  let evaluator: ConfirmationEvaluator;

  beforeEach(() => {
    evaluator = new ConfirmationEvaluator();
    resetSeq();
  });

  describe('evaluate — user-requested confirmation override', () => {
    it('returns explicit when user requires confirmation', () => {
      const op = makeOperation({
        constraints: { requireUserConfirmation: true },
        outputTarget: { type: 'chat-message' },
      });
      const result = evaluator.evaluate(op);
      expect(result.mode).toBe('explicit');
      expect(result.reason).toContain('User');
    });
  });

  describe('evaluate — rule-based mapping', () => {
    const cases: Array<[OutputTarget['type'], string]> = [
      ['chat-message', 'auto'],
      ['editor-selection-replace', 'preview'],
      ['editor-insert-after', 'preview'],
      ['section-append', 'explicit'],
      ['section-replace', 'explicit'],
      ['workflow', 'explicit'],
      ['navigate', 'auto'],
    ];

    it.each(cases)('target "%s" → mode "%s"', (targetType, expectedMode) => {
      const target = { type: targetType } as OutputTarget;
      const op = makeOperation({ outputTarget: target });
      const result = evaluator.evaluate(op);
      expect(result.mode).toBe(expectedMode);
    });
  });

  describe('evaluate — unknown target type fallback', () => {
    it('returns preview for unknown targets', () => {
      const op = makeOperation({
        outputTarget: { type: 'unknown-type' } as unknown as OutputTarget,
      });
      const result = evaluator.evaluate(op);
      expect(result.mode).toBe('preview');
      expect(result.reason).toContain('Unknown');
    });
  });

  describe('evaluate — custom rules', () => {
    it('uses custom rules when provided', () => {
      const custom = new ConfirmationEvaluator([
        { targetType: 'chat-message', mutationRisk: 'high', defaultMode: 'explicit' },
      ]);
      const op = makeOperation({ outputTarget: { type: 'chat-message' } });
      const result = custom.evaluate(op);
      expect(result.mode).toBe('explicit');
    });
  });

  describe('static helpers', () => {
    it('isAutoExecutable returns true only for auto', () => {
      expect(ConfirmationEvaluator.isAutoExecutable('auto')).toBe(true);
      expect(ConfirmationEvaluator.isAutoExecutable('preview')).toBe(false);
      expect(ConfirmationEvaluator.isAutoExecutable('explicit')).toBe(false);
    });

    it('requiresUserInput returns true for explicit, intent-clarification, forbidden', () => {
      expect(ConfirmationEvaluator.requiresUserInput('explicit')).toBe(true);
      expect(ConfirmationEvaluator.requiresUserInput('intent-clarification')).toBe(true);
      expect(ConfirmationEvaluator.requiresUserInput('forbidden')).toBe(true);
      expect(ConfirmationEvaluator.requiresUserInput('auto')).toBe(false);
      expect(ConfirmationEvaluator.requiresUserInput('preview')).toBe(false);
    });
  });
});
