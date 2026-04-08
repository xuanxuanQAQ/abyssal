/**
 * ConfirmationEvaluator — determines whether an operation should
 * auto-execute, preview, require explicit confirmation, or be forbidden.
 */

import type {
  ConfirmationPolicy,
  ConfirmationMode,
  ConfirmationRule,
  CopilotOperation,
} from './types';

const DEFAULT_RULES: ConfirmationRule[] = [
  { targetType: 'chat-message',            mutationRisk: 'low',    defaultMode: 'auto' },
  { targetType: 'editor-selection-replace', mutationRisk: 'medium', defaultMode: 'preview' },
  { targetType: 'editor-insert-after',      mutationRisk: 'medium', defaultMode: 'preview' },
  { targetType: 'section-append',           mutationRisk: 'high',   defaultMode: 'explicit' },
  { targetType: 'section-replace',          mutationRisk: 'high',   defaultMode: 'explicit' },
  { targetType: 'workflow',                 mutationRisk: 'high',   defaultMode: 'explicit' },
  { targetType: 'navigate',                 mutationRisk: 'low',    defaultMode: 'auto' },
];

export class ConfirmationEvaluator {
  private rules: ConfirmationRule[];

  constructor(customRules?: ConfirmationRule[]) {
    this.rules = customRules ?? DEFAULT_RULES;
  }

  evaluate(operation: CopilotOperation): ConfirmationPolicy {
    const target = operation.outputTarget;

    // User explicitly requests confirmation
    if (operation.constraints?.requireUserConfirmation) {
      return {
        mode: 'explicit',
        reason: 'User requested confirmation',
        requiredFor: 'execution',
      };
    }

    const rule = this.rules.find((r) => r.targetType === target.type);
    if (!rule) {
      // Unknown target type → safe default
      return {
        mode: 'preview',
        reason: `Unknown target type: ${target.type}`,
        requiredFor: 'execution',
      };
    }

    return {
      mode: rule.defaultMode,
      reason: `${rule.mutationRisk} risk mutation on ${target.type}`,
      requiredFor: rule.mutationRisk === 'high' ? 'destructive-mutation' : 'execution',
    };
  }

  /** Check if a mode allows auto-execution */
  static isAutoExecutable(mode: ConfirmationMode): boolean {
    return mode === 'auto';
  }

  /** Check if a mode requires user interaction before proceed */
  static requiresUserInput(mode: ConfirmationMode): boolean {
    return mode === 'explicit' || mode === 'intent-clarification' || mode === 'forbidden';
  }
}
