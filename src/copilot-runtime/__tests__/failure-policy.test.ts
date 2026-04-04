import { FailurePolicyEvaluator } from '../failure-policy';
import type { FailureStage } from '../types';

describe('FailurePolicyEvaluator', () => {
  let evaluator: FailurePolicyEvaluator;

  beforeEach(() => {
    evaluator = new FailurePolicyEvaluator();
  });

  describe('evaluate — exact match by stage + condition', () => {
    it('returns exact policy for ambiguous_intent', () => {
      const result = evaluator.evaluate('intent_resolution', 'ambiguous_intent');
      expect(result.degradation).toBe('ask_for_clarification');
      expect(result.retryAllowed).toBe(false);
    });

    it('returns exact policy for stale_patch', () => {
      const result = evaluator.evaluate('patch_reconciliation', 'stale_patch');
      expect(result.degradation).toBe('abort_without_apply');
      expect(result.preserveArtifacts).toBe(true);
    });
  });

  describe('evaluate — stage-level fallback', () => {
    it('falls back to first matching stage policy when condition is unknown', () => {
      const result = evaluator.evaluate('retrieval', 'some_weird_error');
      expect(result.stage).toBe('retrieval');
      expect(result.degradation).toBeDefined();
    });
  });

  describe('evaluate — ultimate fallback for unknown stage', () => {
    it('returns fallback_to_chat_message for completely unknown stages', () => {
      const result = evaluator.evaluate('unknown_stage' as FailureStage);
      expect(result.degradation).toBe('fallback_to_chat_message');
      expect(result.retryAllowed).toBe(false);
    });
  });

  describe('evaluate — key degradation mappings', () => {
    const cases: Array<[FailureStage, string, string]> = [
      ['intent_resolution',     'ambiguous_intent',          'ask_for_clarification'],
      ['recipe_resolution',     'multiple_recipes_conflict', 'ask_for_clarification'],
      ['context_building',      'insufficient_context',      'fallback_to_chat_message'],
      ['generation',            'model_output_invalid',      'fallback_to_chat_message'],
      ['validation',            'citation_validation_failed','fallback_to_patch_preview'],
      ['patch_apply',           'transaction_failed',        'fallback_to_patch_preview'],
      ['workflow_execution',    'workflow_error',            'return_partial_result'],
    ];

    it.each(cases)('stage=%s condition=%s → %s', (stage, condition, expectedMode) => {
      const result = evaluator.evaluate(stage, condition);
      expect(result.degradation).toBe(expectedMode);
    });
  });

  describe('evaluate — preserveArtifacts flag', () => {
    it('preserves artifacts for context_building failures', () => {
      const result = evaluator.evaluate('context_building', 'insufficient_context');
      expect(result.preserveArtifacts).toBe(true);
    });

    it('does not preserve artifacts for intent failures', () => {
      const result = evaluator.evaluate('intent_resolution', 'ambiguous_intent');
      expect(result.preserveArtifacts).toBe(false);
    });
  });

  describe('buildRecord', () => {
    it('builds a DegradationRecord from stage + reason', () => {
      const record = evaluator.buildRecord('generation', 'LLM returned garbage');
      expect(record.stage).toBe('generation');
      expect(record.mode).toBeDefined();
      expect(record.reason).toBe('LLM returned garbage');
    });

    it('includes preservedArtifacts when provided', () => {
      const record = evaluator.buildRecord('retrieval', 'timeout', ['retrieval_results']);
      expect(record.preservedArtifacts).toEqual(['retrieval_results']);
    });
  });

  describe('custom policies', () => {
    it('uses custom policies when provided', () => {
      const custom = new FailurePolicyEvaluator([
        {
          stage: 'generation',
          condition: 'custom_error',
          degradation: 'abort_without_apply',
          userMessage: 'Custom error',
          preserveArtifacts: false,
          retryAllowed: false,
        },
      ]);
      const result = custom.evaluate('generation', 'custom_error');
      expect(result.degradation).toBe('abort_without_apply');
    });
  });
});
