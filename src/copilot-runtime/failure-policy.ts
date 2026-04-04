/**
 * FailurePolicyEvaluator — maps failure stages to degradation modes.
 *
 * Core principle: prefer degradation over total failure.
 * - Never silently apply a stale patch
 * - Never randomly pick a recipe when ambiguous
 * - Always preserve partial results when possible
 */

import type {
  FailureStage,
  DegradationMode,
  FailurePolicy,
  DegradationRecord,
} from './types';

const DEFAULT_POLICIES: FailurePolicy[] = [
  {
    stage: 'intent_resolution',
    condition: 'ambiguous_intent',
    degradation: 'ask_for_clarification',
    userMessage: '请选择您想要执行的操作',
    preserveArtifacts: false,
    retryAllowed: false,
  },
  {
    stage: 'recipe_resolution',
    condition: 'multiple_recipes_conflict',
    degradation: 'ask_for_clarification',
    userMessage: '多个操作匹配，请选择具体动作',
    preserveArtifacts: false,
    retryAllowed: false,
  },
  {
    stage: 'context_building',
    condition: 'insufficient_context',
    degradation: 'fallback_to_chat_message',
    userMessage: '上下文不足，已降级为对话回复',
    preserveArtifacts: true,
    retryAllowed: true,
  },
  {
    stage: 'retrieval',
    condition: 'retrieval_failed_or_empty',
    degradation: 'fallback_to_plain_draft',
    userMessage: '证据不足，已生成无引用草稿',
    preserveArtifacts: true,
    retryAllowed: true,
  },
  {
    stage: 'retrieval',
    condition: 'retrieval_required_but_empty',
    degradation: 'abort_without_apply',
    userMessage: '无法找到相关证据，操作已中止',
    preserveArtifacts: false,
    retryAllowed: true,
  },
  {
    stage: 'generation',
    condition: 'model_output_invalid',
    degradation: 'fallback_to_chat_message',
    userMessage: '生成结果格式异常，已降级为文本回复',
    preserveArtifacts: true,
    retryAllowed: true,
  },
  {
    stage: 'validation',
    condition: 'citation_validation_failed',
    degradation: 'fallback_to_patch_preview',
    userMessage: '引用格式未通过校验，请手动确认',
    preserveArtifacts: true,
    retryAllowed: false,
  },
  {
    stage: 'patch_reconciliation',
    condition: 'stale_patch',
    degradation: 'abort_without_apply',
    userMessage: '目标位置已变化，未自动写入',
    preserveArtifacts: true,
    retryAllowed: false,
  },
  {
    stage: 'patch_apply',
    condition: 'transaction_failed',
    degradation: 'fallback_to_patch_preview',
    userMessage: '写入失败，可手动插入内容',
    preserveArtifacts: true,
    retryAllowed: false,
  },
  {
    stage: 'workflow_execution',
    condition: 'workflow_error',
    degradation: 'return_partial_result',
    userMessage: '工作流执行部分失败',
    preserveArtifacts: true,
    retryAllowed: true,
  },
  {
    stage: 'navigation_execution',
    condition: 'target_not_found',
    degradation: 'fallback_to_chat_message',
    userMessage: '导航目标不存在',
    preserveArtifacts: false,
    retryAllowed: false,
  },
];

export class FailurePolicyEvaluator {
  private policies: FailurePolicy[];

  constructor(customPolicies?: FailurePolicy[]) {
    this.policies = customPolicies ?? DEFAULT_POLICIES;
  }

  /** Find the best matching degradation for a given failure */
  evaluate(stage: FailureStage, condition?: string): FailurePolicy {
    // Try exact match first
    if (condition) {
      const exact = this.policies.find(
        (p) => p.stage === stage && p.condition === condition,
      );
      if (exact) return exact;
    }

    // Fallback to stage-level match
    const stageMatch = this.policies.find((p) => p.stage === stage);
    if (stageMatch) return stageMatch;

    // Ultimate fallback
    return {
      stage,
      condition: condition ?? 'unknown',
      degradation: 'fallback_to_chat_message',
      userMessage: '操作执行异常，已降级为文本回复',
      preserveArtifacts: true,
      retryAllowed: false,
    };
  }

  /** Build a DegradationRecord from a policy match */
  buildRecord(
    stage: FailureStage,
    reason: string,
    preservedArtifacts?: DegradationRecord['preservedArtifacts'],
  ): DegradationRecord {
    const policy = this.evaluate(stage);
    return {
      stage,
      mode: policy.degradation,
      reason,
      ...(preservedArtifacts ? { preservedArtifacts } : {}),
    };
  }
}
