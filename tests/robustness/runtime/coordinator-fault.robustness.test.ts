/**
 * Robustness tests — ExecutionCoordinator fault injection.
 *
 * Verifies abort, resume, duplicate submit, timeout, and retry
 * degradation paths at the orchestration level.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionCoordinator } from '../../../src/copilot-runtime/execution-coordinator';
import type { ExecutionCoordinatorDeps } from '../../../src/copilot-runtime/execution-coordinator';
import { IntentRouter } from '../../../src/copilot-runtime/intent-router';
import { RecipeRegistry } from '../../../src/copilot-runtime/recipe-registry';
import { OperationEventEmitter } from '../../../src/copilot-runtime/event-emitter';
import { TraceStore } from '../../../src/copilot-runtime/trace-store';
import { CopilotSessionManager } from '../../../src/copilot-runtime/session-manager';
import { IdempotencyGuard } from '../../../src/copilot-runtime/idempotency-guard';
import { ConfirmationEvaluator } from '../../../src/copilot-runtime/confirmation';
import { FailurePolicyEvaluator } from '../../../src/copilot-runtime/failure-policy';
import type {
  CopilotOperationEnvelope,
  CopilotOperation,
  CopilotOperationEvent,
  ContextSnapshot,
} from '../../../src/copilot-runtime/types';

let seq = 0;
function resetSeq() { seq = 0; }

function makeContext(overrides?: Partial<ContextSnapshot>): ContextSnapshot {
  return {
    activeView: 'library' as const,
    workspaceId: 'ws-1',
    article: null,
    selection: null,
    focusEntities: { paperIds: [], conceptIds: [] },
    conversation: { recentTurns: [] },
    retrieval: { evidence: [] },
    writing: null,
    budget: { policy: 'standard' as const, tokenBudget: 4000, includedLayers: ['surface' as const, 'working' as const] },
    frozenAt: Date.now(),
    ...overrides,
  };
}

function makeOp(overrides?: Partial<CopilotOperation>): CopilotOperation {
  seq++;
  return {
    id: `op-${seq}`,
    sessionId: `sess-${seq}`,
    surface: 'chat' as const,
    intent: 'ask' as const,
    prompt: 'test prompt',
    context: makeContext(),
    outputTarget: { type: 'chat-message' },
    ...overrides,
  };
}

function makeEnvelope(overrides?: Partial<CopilotOperation>): CopilotOperationEnvelope {
  return { operation: makeOp(overrides) };
}

function makeMockContextBuilder() {
  return {
    build: vi.fn().mockImplementation(async (op: CopilotOperation) =>
      op.context ?? makeContext(),
    ),
  };
}

function makeMockAgentExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({
      text: 'LLM response',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

function makeMockRetrievalExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({
      evidence: [],
      query: 'test',
    }),
  };
}

function makeMockEditorExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({
      applied: true,
      patch: { kind: 'replace-range', editorId: 'main', from: 0, to: 5, content: {} },
      reconciliation: { ok: true },
    }),
  };
}

function makeMockWorkflowExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({ taskId: 'task-1', success: true }),
  };
}

function makeMockNavigationExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({ success: true, view: 'library' }),
  };
}

function makeRecipe(id = 'test-recipe') {
  return {
    id,
    intents: ['ask' as const],
    priority: 5,
    specificity: 5,
    matches: () => true,
    buildPlan: async () => ({
      recipeId: id,
      target: { type: 'chat-message' as const },
      steps: [{ kind: 'llm_generate' as const, mode: 'chat' }],
      confirmation: { mode: 'auto' as const, reason: 'test', requiredFor: 'execution' as const },
    }),
  };
}

function makeDeps(overrides?: Partial<ExecutionCoordinatorDeps>): ExecutionCoordinatorDeps {
  const registry = new RecipeRegistry();
  registry.register(makeRecipe());

  return {
    router: new IntentRouter(),
    contextBuilder: makeMockContextBuilder() as any,
    recipeRegistry: registry,
    emitter: new OperationEventEmitter(),
    traceStore: new TraceStore(),
    sessionManager: new CopilotSessionManager(),
    idempotencyGuard: new IdempotencyGuard(),
    confirmationEvaluator: new ConfirmationEvaluator(),
    failurePolicy: new FailurePolicyEvaluator(),
    agentExecutor: makeMockAgentExecutor() as any,
    retrievalExecutor: makeMockRetrievalExecutor() as any,
    editorExecutor: makeMockEditorExecutor() as any,
    workflowExecutor: makeMockWorkflowExecutor() as any,
    navigationExecutor: makeMockNavigationExecutor() as any,
    ...overrides,
  };
}

describe('ExecutionCoordinator robustness — abort scenarios', () => {
  beforeEach(() => {
    resetSeq();
    vi.clearAllMocks();
  });

  it('aborts mid-execution when abort called during context build', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator({
      ...deps,
      contextBuilder: {
        build: vi.fn().mockImplementation(async (op: CopilotOperation) => {
          coordinator.abort(op.id);
          return makeContext();
        }),
      } as any,
    });

    const events: string[] = [];
    deps.emitter.on((e) => events.push(e.type));

    const result = await coordinator.execute(makeEnvelope({ id: 'op-abort-ctx' }));

    expect(result.operationId).toBe('op-abort-ctx');
    expect(deps.agentExecutor.execute).not.toHaveBeenCalled();
    expect(events).toContain('operation.aborted');
  });

  it('records aborted terminal state in session manager', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator({
      ...deps,
      contextBuilder: {
        build: vi.fn().mockImplementation(async (op: CopilotOperation) => {
          coordinator.abort(op.id);
          return makeContext();
        }),
      } as any,
    });

    deps.emitter.on((e) => deps.sessionManager.appendEvent(e));
    await coordinator.execute(makeEnvelope({ id: 'op-abort-sm' }));

    const status = deps.sessionManager.getOperationStatus('op-abort-sm');
    expect(status?.status).toBe('aborted');
  });
});

describe('ExecutionCoordinator robustness — duplicate submission', () => {
  beforeEach(() => {
    resetSeq();
    vi.clearAllMocks();
  });

  it('deduplicates repeated submissions within idempotency window', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator(deps);

    const result1 = await coordinator.execute(makeEnvelope({
      id: 'op-first',
      sessionId: 'sess-1',
      prompt: 'same prompt',
      surface: 'chat',
    }));

    const result2 = await coordinator.execute(makeEnvelope({
      id: 'op-second',
      sessionId: 'sess-1',
      prompt: 'same prompt',
      surface: 'chat',
    }));

    expect(result1.operationId).toBe('op-first');
    expect(result2.operationId).toBe('op-first');
    expect(deps.agentExecutor.execute).toHaveBeenCalledTimes(1);
  });
});

describe('ExecutionCoordinator robustness — executor failure', () => {
  beforeEach(() => {
    resetSeq();
    vi.clearAllMocks();
  });

  it('records failed state when agent executor throws', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator(deps);
    (deps.agentExecutor.execute as any).mockRejectedValue(new Error('LLM provider down'));

    const events: string[] = [];
    deps.emitter.on((e) => events.push(e.type));
    deps.emitter.on((e) => deps.sessionManager.appendEvent(e));

    const result = await coordinator.execute(makeEnvelope({ id: 'op-fail' }));

    expect(result.operationId).toBe('op-fail');
    const status = deps.sessionManager.getOperationStatus('op-fail');
    expect(status?.status).toBe('failed');
    expect(deps.traceStore.getSummaries(1)[0]?.status).toBe('failed');
  });

  it('preserves trace phases even on failure', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator(deps);
    (deps.agentExecutor.execute as any).mockRejectedValue(new Error('timeout'));

    await coordinator.execute(makeEnvelope({ id: 'op-trace' }));

    const trace = deps.traceStore.getTrace('op-trace');
    expect(trace).toBeDefined();
    expect(trace!.phases.length).toBeGreaterThan(0);
  });
});

describe('ExecutionCoordinator robustness — no matching recipe', () => {
  beforeEach(() => {
    resetSeq();
    vi.clearAllMocks();
  });

  it('handles no matching recipe gracefully', async () => {
    const emptyRegistry = new RecipeRegistry();
    const deps = makeDeps({ recipeRegistry: emptyRegistry });
    const coordinator = new ExecutionCoordinator(deps);

    const result = await coordinator.execute(makeEnvelope({ id: 'op-no-recipe' }));

    // Should either fallback to chat or return a clarification
    expect(result.operationId).toBe('op-no-recipe');
  });
});

describe('IdempotencyGuard robustness', () => {
  it('allows reuse after release and expiry', () => {
    vi.useFakeTimers();
    try {
      const guard = new IdempotencyGuard();
      const key = {
        operationId: 'op-reuse',
        surface: 'chat' as const,
        fingerprint: 'fp-same',
        dedupeWindowMs: 1200,
      };

      guard.register(key);
      expect(guard.checkDuplicate(key)).toBe('op-reuse');

      guard.release('op-reuse');
      // release removes from activeOperations but fingerprint stays in window
      // advance past dedupe window so fingerprint expires
      vi.advanceTimersByTime(1300);
      expect(guard.checkDuplicate({ ...key, operationId: 'op-new' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleanup removes expired fingerprint entries', () => {
    vi.useFakeTimers();
    try {
      const guard = new IdempotencyGuard();
      const key = {
        operationId: 'op-old',
        surface: 'chat' as const,
        fingerprint: 'fp-old',
        dedupeWindowMs: 100,
      };

      guard.register(key);
      // Advance past dedupe window
      vi.advanceTimersByTime(200);
      guard.cleanup();

      expect(guard.checkDuplicate({
        ...key,
        operationId: 'op-new',
      })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds deterministic fingerprints', () => {
    const fp1 = IdempotencyGuard.buildFingerprint('chat', 'hello', 'selected');
    const fp2 = IdempotencyGuard.buildFingerprint('chat', 'hello', 'selected');
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(16);
  });

  it('different inputs produce different fingerprints', () => {
    const fp1 = IdempotencyGuard.buildFingerprint('chat', 'hello');
    const fp2 = IdempotencyGuard.buildFingerprint('chat', 'world');
    expect(fp1).not.toBe(fp2);
  });
});
