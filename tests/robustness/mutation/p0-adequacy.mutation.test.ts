/**
 * P0 mutation adequacy — targeted boundary tests for critical paths.
 *
 * These tests verify that mutations at critical decision points
 * (output target selection, plan step execution, confirmation mode)
 * would be killed by the test suite.
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
import type { CopilotOperation, CopilotOperationEnvelope } from '../../../src/copilot-runtime/types';

let seq = 0;

function makeContext() {
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
  };
}

function makeOp(overrides?: Partial<CopilotOperation>): CopilotOperation {
  seq++;
  return {
    id: `op-mut-${seq}`,
    sessionId: `sess-mut-${seq}`,
    surface: 'chat',
    intent: 'ask',
    prompt: 'test',
    context: makeContext(),
    outputTarget: { type: 'chat-message' },
    ...overrides,
  } as CopilotOperation;
}

function makeEnvelope(overrides?: Partial<CopilotOperation>): CopilotOperationEnvelope {
  return { operation: makeOp(overrides) };
}

function makeDeps(overrides?: Partial<ExecutionCoordinatorDeps>): ExecutionCoordinatorDeps {
  const registry = new RecipeRegistry();
  registry.register({
    id: 'test-recipe',
    intents: ['ask'],
    priority: 5,
    specificity: 5,
    matches: () => true,
    buildPlan: async () => ({
      recipeId: 'test-recipe',
      target: { type: 'chat-message' },
      steps: [{ kind: 'llm_generate', mode: 'chat' }],
      confirmation: { mode: 'auto', reason: 'test', requiredFor: 'execution' },
    }),
  });

  return {
    router: new IntentRouter(),
    contextBuilder: {
      build: vi.fn().mockImplementation(async (op: CopilotOperation) => op.context ?? makeContext()),
    } as any,
    recipeRegistry: registry,
    emitter: new OperationEventEmitter(),
    traceStore: new TraceStore(),
    sessionManager: new CopilotSessionManager(),
    idempotencyGuard: new IdempotencyGuard(),
    confirmationEvaluator: new ConfirmationEvaluator(),
    failurePolicy: new FailurePolicyEvaluator(),
    agentExecutor: {
      execute: vi.fn().mockResolvedValue({
        text: 'response',
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    } as any,
    retrievalExecutor: { execute: vi.fn().mockResolvedValue({ evidence: [], query: '' }) } as any,
    editorExecutor: { execute: vi.fn().mockResolvedValue({ applied: true }) } as any,
    workflowExecutor: { execute: vi.fn().mockResolvedValue({ success: true }) } as any,
    navigationExecutor: { execute: vi.fn().mockResolvedValue({ success: true }) } as any,
    ...overrides,
  };
}

describe('P0 mutation adequacy — intent router boundaries', () => {
  const router = new IntentRouter();

  beforeEach(() => { seq = 0; vi.clearAllMocks(); });

  it('KILL: removing rewrite keyword match would change classification', async () => {
    const result = await router.classify(makeOp({ intent: 'ask', prompt: '改写这段话' }));
    expect(result.intent).toBe('rewrite-selection');
    // If the 改写 keyword were removed, this would become 'ask'
    expect(result.intent).not.toBe('ask');
  });

  it('KILL: changing confidence formula would break threshold', async () => {
    const result = await router.classify(makeOp({ intent: 'ask', prompt: '改写' }));
    // confidence = 0.6 + priority * 0.03, for priority 10: ~0.9
    expect(result.confidence).toBeCloseTo(0.9, 10);
    expect(result.confidence).toBeGreaterThan(0.55); // CONFIDENCE_THRESHOLD
  });

  it('KILL: swapping output target inference for editor selection', async () => {
    const result = await router.classify(makeOp({
      intent: 'ask',
      prompt: '改写',
      context: {
        ...makeContext(),
        selection: {
          kind: 'editor' as const,
          articleId: 'a1',
          sectionId: 's1',
          selectedText: 'text',
          from: 0,
          to: 4,
        },
      },
    }));
    expect(result.outputTarget.type).toBe('editor-selection-replace');
  });

  it('KILL: removing navigate detection would fall through to ask', async () => {
    const result = await router.classify(makeOp({ intent: 'ask', prompt: '跳转到图书馆' }));
    expect(result.intent).toBe('navigate');
    expect(result.outputTarget.type).toBe('navigate');
  });
});

describe('P0 mutation adequacy — confirmation evaluator boundaries', () => {
  const evaluator = new ConfirmationEvaluator();

  it('KILL: chat-message must be auto (not preview/explicit)', () => {
    const policy = evaluator.evaluate(makeOp());
    expect(policy.mode).toBe('auto');
    expect(ConfirmationEvaluator.isAutoExecutable(policy.mode)).toBe(true);
  });

  it('KILL: workflow must require explicit confirmation', () => {
    const policy = evaluator.evaluate(makeOp({
      outputTarget: { type: 'workflow', workflow: 'analyze' as any },
    }));
    expect(policy.mode).toBe('explicit');
    expect(ConfirmationEvaluator.requiresUserInput(policy.mode)).toBe(true);
  });

  it('KILL: unknown target type defaults to preview (not auto)', () => {
    const policy = evaluator.evaluate(makeOp({
      outputTarget: { type: 'unknown-target' as any },
    }));
    expect(policy.mode).toBe('preview');
    expect(policy.mode).not.toBe('auto');
  });

  it('KILL: static helpers return correct boolean values', () => {
    expect(ConfirmationEvaluator.isAutoExecutable('auto')).toBe(true);
    expect(ConfirmationEvaluator.isAutoExecutable('preview')).toBe(false);
    expect(ConfirmationEvaluator.isAutoExecutable('explicit')).toBe(false);

    expect(ConfirmationEvaluator.requiresUserInput('explicit')).toBe(true);
    expect(ConfirmationEvaluator.requiresUserInput('auto')).toBe(false);
    expect(ConfirmationEvaluator.requiresUserInput('preview')).toBe(false);
  });
});

describe('P0 mutation adequacy — failure policy boundaries', () => {
  const policy = new FailurePolicyEvaluator();

  it('KILL: stale_patch must NOT allow retry', () => {
    const result = policy.evaluate('patch_reconciliation', 'stale_patch');
    expect(result.retryAllowed).toBe(false);
    expect(result.preserveArtifacts).toBe(true);
  });

  it('KILL: ambiguous_intent must NOT preserve artifacts', () => {
    const result = policy.evaluate('intent_resolution', 'ambiguous_intent');
    expect(result.preserveArtifacts).toBe(false);
    expect(result.degradation).toBe('ask_for_clarification');
  });

  it('KILL: retrieval failure allows retry', () => {
    const result = policy.evaluate('retrieval', 'retrieval_failed_or_empty');
    expect(result.retryAllowed).toBe(true);
    expect(result.degradation).toBe('fallback_to_plain_draft');
  });

  it('KILL: buildRecord produces correct DegradationRecord', () => {
    const record = policy.buildRecord('generation', 'model output invalid');
    expect(record.stage).toBe('generation');
    expect(record.mode).toBe('fallback_to_chat_message');
    expect(record.reason).toBe('model output invalid');
  });
});

describe('P0 mutation adequacy — session manager boundaries', () => {
  it('KILL: terminal state is queryable after completion', () => {
    const sm = new CopilotSessionManager();
    const op = makeOp();
    sm.trackOperation(op);

    const emitter = new OperationEventEmitter();
    emitter.on((e) => sm.appendEvent(e));
    emitter.emit({ type: 'operation.completed', operationId: op.id, resultSummary: 'success' } as any);

    expect(sm.isTerminal(op.id)).toBe(true);
    expect(sm.getTerminalState(op.id)?.terminalStatus).toBe('completed');
  });

  it('KILL: cleared session removes all operation mappings', () => {
    const sm = new CopilotSessionManager();
    const op = makeOp({ sessionId: 'sess-clear' });
    sm.trackOperation(op);

    sm.clear('sess-clear');

    expect(sm.getOperationStatus(op.id)).toBeNull();
    expect(sm.get('sess-clear')).toBeNull();
  });

  it('KILL: evicts oldest sessions when exceeding MAX_SESSIONS', () => {
    const sm = new CopilotSessionManager();

    // Create 52 sessions (MAX is 50)
    for (let i = 0; i < 52; i++) {
      const op = makeOp({ sessionId: `sess-evict-${i}` });
      sm.trackOperation(op);
    }

    const sessions = sm.list();
    expect(sessions.length).toBeLessThanOrEqual(50);
  });
});

describe('P0 mutation adequacy — trace store boundaries', () => {
  it('KILL: ring buffer evicts oldest traces beyond MAX_MEMORY_TRACES', () => {
    const store = new TraceStore();

    for (let i = 0; i < 55; i++) {
      store.createTrace(`op-ring-${i}`, 'sess-1');
    }

    // First few should be evicted
    expect(store.getTrace('op-ring-0')).toBeUndefined();
    expect(store.getTrace('op-ring-54')).toBeDefined();
  });

  it('KILL: phase failure is recorded with error details', () => {
    const store = new TraceStore();
    store.createTrace('op-phase-fail', 'sess-1');
    store.startPhase('op-phase-fail', 'execution');
    store.failPhase('op-phase-fail', 'execution', {
      code: 'TIMEOUT',
      message: 'Provider timeout after 30s',
    });

    const trace = store.getTrace('op-phase-fail');
    const failedPhase = trace?.phases.find((p) => p.name === 'execution');
    expect(failedPhase?.status).toBe('failed');
    expect(failedPhase?.error?.code).toBe('TIMEOUT');
  });
});
