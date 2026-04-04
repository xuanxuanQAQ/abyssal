/**
 * Shared test helpers for copilot-runtime tests.
 */
import type {
  CopilotOperation,
  CopilotSurface,
  CopilotIntent,
  ContextSnapshot,
  OutputTarget,
  OperationRecipe,
  ExecutionPlan,
  IdempotencyKey,
} from '../types';

let seq = 0;
export function resetSeq(): void { seq = 0; }

export function makeOperation(overrides?: Partial<CopilotOperation>): CopilotOperation {
  seq++;
  return {
    id: `op-${seq}`,
    sessionId: `sess-${seq}`,
    surface: 'chat' as CopilotSurface,
    intent: 'ask' as CopilotIntent,
    prompt: 'some prompt',
    context: makeContext(),
    outputTarget: { type: 'chat-message' } as OutputTarget,
    ...overrides,
  };
}

export function makeContext(overrides?: Partial<ContextSnapshot>): ContextSnapshot {
  return {
    activeView: 'library' as const,
    workspaceId: 'ws-1',
    article: null,
    selection: null,
    focusEntities: { paperIds: [], conceptIds: [] },
    conversation: { recentTurns: [] },
    retrieval: { evidence: [] },
    writing: null,
    budget: { policy: 'standard', tokenBudget: 4000, includedLayers: ['surface', 'working'] },
    frozenAt: Date.now(),
    ...overrides,
  };
}

export function makeRecipe(overrides?: Partial<OperationRecipe> & { matchReturn?: boolean }): OperationRecipe {
  seq++;
  const matchReturn = overrides?.matchReturn ?? true;
  return {
    id: overrides?.id ?? `recipe-${seq}`,
    intents: overrides?.intents ?? ['ask'],
    priority: overrides?.priority ?? 5,
    specificity: overrides?.specificity ?? 5,
    matches: overrides?.matches ?? (() => matchReturn),
    buildPlan: overrides?.buildPlan ?? (async (op) => makePlan(overrides?.id ?? `recipe-${seq}`)),
  };
}

export function makePlan(recipeId = 'test-recipe'): ExecutionPlan {
  return {
    recipeId,
    target: { type: 'chat-message' },
    steps: [{ kind: 'llm_generate', mode: 'chat' }],
    confirmation: { mode: 'auto', reason: 'test', requiredFor: 'execution' },
  };
}

export function makeIdempotencyKey(overrides?: Partial<IdempotencyKey>): IdempotencyKey {
  seq++;
  return {
    operationId: `op-${seq}`,
    surface: 'chat',
    fingerprint: `fp-${seq}`,
    dedupeWindowMs: 1200,
    ...overrides,
  };
}
