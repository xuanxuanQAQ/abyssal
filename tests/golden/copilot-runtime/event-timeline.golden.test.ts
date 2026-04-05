/**
 * Golden tests — copilot-runtime event timeline & operation lifecycle.
 *
 * Freezes the event sequence for standard operations so that
 * refactoring doesn't change the observable event timeline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OperationEventEmitter } from '../../../src/copilot-runtime/event-emitter';
import { CopilotSessionManager } from '../../../src/copilot-runtime/session-manager';
import { TraceStore } from '../../../src/copilot-runtime/trace-store';
import { IntentRouter } from '../../../src/copilot-runtime/intent-router';
import { ConfirmationEvaluator } from '../../../src/copilot-runtime/confirmation';
import { FailurePolicyEvaluator } from '../../../src/copilot-runtime/failure-policy';
import { IdempotencyGuard } from '../../../src/copilot-runtime/idempotency-guard';
import { RecipeRegistry } from '../../../src/copilot-runtime/recipe-registry';
import { ExecutionCoordinator } from '../../../src/copilot-runtime/execution-coordinator';
import type { CopilotOperationEvent, CopilotOperation, CopilotOperationEnvelope } from '../../../src/copilot-runtime/types';

function makeOp(overrides?: Partial<CopilotOperation>): CopilotOperation {
  return {
    id: 'op-golden-1',
    sessionId: 'sess-golden-1',
    surface: 'chat',
    intent: 'ask',
    prompt: '这篇论文的主要发现是什么？',
    context: {
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
    },
    outputTarget: { type: 'chat-message' },
    ...overrides,
  };
}

describe('event timeline golden', () => {
  let emitter: OperationEventEmitter;
  let events: CopilotOperationEvent[];

  beforeEach(() => {
    emitter = new OperationEventEmitter();
    events = [];
    emitter.on((e) => events.push(e));
  });

  it('emits events with auto-incrementing sequence per operation', () => {
    emitter.emit({ type: 'operation.started', operationId: 'op-1' } as any);
    emitter.emit({ type: 'operation.context_built', operationId: 'op-1' } as any);
    emitter.emit({ type: 'operation.completed', operationId: 'op-1' } as any);

    expect(events.map((e) => ({ type: e.type, seq: e.sequence }))).toMatchInlineSnapshot(`
      [
        {
          "seq": 1,
          "type": "operation.started",
        },
        {
          "seq": 2,
          "type": "operation.context_built",
        },
        {
          "seq": 3,
          "type": "operation.completed",
        },
      ]
    `);
  });

  it('maintains separate sequence counters per operation', () => {
    emitter.emit({ type: 'operation.started', operationId: 'op-a' } as any);
    emitter.emit({ type: 'operation.started', operationId: 'op-b' } as any);
    emitter.emit({ type: 'operation.completed', operationId: 'op-a' } as any);
    emitter.emit({ type: 'operation.completed', operationId: 'op-b' } as any);

    expect(events.map((e) => [e.operationId, e.sequence])).toMatchInlineSnapshot(`
      [
        [
          "op-a",
          1,
        ],
        [
          "op-b",
          1,
        ],
        [
          "op-a",
          2,
        ],
        [
          "op-b",
          2,
        ],
      ]
    `);
  });

  it('listener errors do not break the emit chain', () => {
    emitter.on(() => { throw new Error('bad listener'); });
    const safeEvents: CopilotOperationEvent[] = [];
    emitter.on((e) => safeEvents.push(e));

    emitter.emit({ type: 'operation.started', operationId: 'op-1' } as any);

    expect(safeEvents).toHaveLength(1);
    expect(safeEvents[0]!.type).toBe('operation.started');
  });
});

describe('session manager golden — operation tracking', () => {
  let sm: CopilotSessionManager;

  beforeEach(() => {
    sm = new CopilotSessionManager();
  });

  it('tracks operation and transitions through terminal states', () => {
    const op = makeOp();
    sm.trackOperation(op);

    const emitter = new OperationEventEmitter();
    emitter.on((e) => sm.appendEvent(e));

    emitter.emit({ type: 'operation.started', operationId: 'op-golden-1' } as any);
    emitter.emit({ type: 'operation.completed', operationId: 'op-golden-1', resultSummary: 'success' } as any);

    const status = sm.getOperationStatus('op-golden-1');
    expect(status).toMatchInlineSnapshot(`
      {
        "lastSequence": 2,
        "operationId": "op-golden-1",
        "sessionId": "sess-golden-1",
        "status": "completed",
        "updatedAt": ${status!.updatedAt},
      }
    `);
  });

  it('records failed operation in terminal state', () => {
    const op = makeOp({ id: 'op-fail' });
    sm.trackOperation(op);

    const emitter = new OperationEventEmitter();
    emitter.on((e) => sm.appendEvent(e));

    emitter.emit({ type: 'operation.started', operationId: 'op-fail' } as any);
    emitter.emit({ type: 'operation.failed', operationId: 'op-fail', error: { code: 'LLM_ERROR', message: 'Model unavailable' } } as any);

    expect(sm.isTerminal('op-fail')).toBe(true);
    expect(sm.getTerminalState('op-fail')?.terminalStatus).toBe('failed');
  });

  it('records aborted operation in terminal state', () => {
    const op = makeOp({ id: 'op-abort' });
    sm.trackOperation(op);

    const emitter = new OperationEventEmitter();
    emitter.on((e) => sm.appendEvent(e));

    emitter.emit({ type: 'operation.started', operationId: 'op-abort' } as any);
    emitter.emit({ type: 'operation.aborted', operationId: 'op-abort' } as any);

    expect(sm.isTerminal('op-abort')).toBe(true);
    expect(sm.getTerminalState('op-abort')?.terminalStatus).toBe('aborted');
  });
});

describe('trace store golden — phase recording', () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore();
  });

  it('records full operation lifecycle phases', () => {
    store.createTrace('op-1', 'sess-1');
    store.startPhase('op-1', 'intent_resolution');
    store.completePhase('op-1', 'intent_resolution', { intent: 'ask' });
    store.startPhase('op-1', 'context_building');
    store.completePhase('op-1', 'context_building');
    store.startPhase('op-1', 'recipe_resolution');
    store.completePhase('op-1', 'recipe_resolution', { recipeId: 'builtin:ask' });
    store.startPhase('op-1', 'execution');
    store.completePhase('op-1', 'execution');
    store.finalizeTrace('op-1', 'completed', 'ask', 'chat', 'builtin:ask');

    const trace = store.getTrace('op-1');
    expect(trace?.phases.map((p) => ({ name: p.name, status: p.status }))).toMatchInlineSnapshot(`
      [
        {
          "name": "intent_resolution",
          "status": "completed",
        },
        {
          "name": "context_building",
          "status": "completed",
        },
        {
          "name": "recipe_resolution",
          "status": "completed",
        },
        {
          "name": "execution",
          "status": "completed",
        },
      ]
    `);

    const summaries = store.getSummaries(1);
    expect(summaries[0]?.status).toBe('completed');
    expect(summaries[0]?.intent).toBe('ask');
    expect(summaries[0]?.recipeId).toBe('builtin:ask');
  });

  it('records degradation during failed phase', () => {
    store.createTrace('op-fail', 'sess-1');
    store.startPhase('op-fail', 'execution');
    store.failPhase('op-fail', 'execution', {
      code: 'LLM_ERROR',
      message: 'Provider unavailable',
    });
    store.addDegradation('op-fail', {
      stage: 'generation',
      mode: 'fallback_to_chat_message',
      reason: 'LLM provider unavailable',
    });
    store.finalizeTrace('op-fail', 'failed', 'ask', 'chat');

    const trace = store.getTrace('op-fail');
    expect(trace?.degradations).toHaveLength(1);
    expect(trace?.degradations![0].mode).toBe('fallback_to_chat_message');
  });
});

describe('confirmation evaluator golden', () => {
  const evaluator = new ConfirmationEvaluator();

  it('auto-executes chat-message targets', () => {
    const policy = evaluator.evaluate(makeOp());
    expect(policy).toMatchInlineSnapshot(`
      {
        "mode": "auto",
        "reason": "low risk mutation on chat-message",
        "requiredFor": "execution",
      }
    `);
  });

  it('requires preview for editor-selection-replace', () => {
    const policy = evaluator.evaluate(makeOp({
      outputTarget: { type: 'editor-selection-replace', editorId: 'main', articleId: 'a1', sectionId: 's1', from: 0, to: 10 },
    }));
    expect(policy.mode).toBe('preview');
  });

  it('requires explicit confirmation for workflow targets', () => {
    const policy = evaluator.evaluate(makeOp({
      outputTarget: { type: 'workflow', workflow: 'analyze' as any },
    }));
    expect(policy.mode).toBe('explicit');
    expect(policy.requiredFor).toBe('destructive-mutation');
  });

  it('overrides to explicit when user requests confirmation', () => {
    const policy = evaluator.evaluate(makeOp({
      constraints: { requireUserConfirmation: true },
    }));
    expect(policy.mode).toBe('explicit');
    expect(policy.reason).toBe('User requested confirmation');
  });
});

describe('failure policy golden', () => {
  const policy = new FailurePolicyEvaluator();

  it('maps ambiguous intent to ask_for_clarification', () => {
    const result = policy.evaluate('intent_resolution', 'ambiguous_intent');
    expect(result).toMatchInlineSnapshot(`
      {
        "condition": "ambiguous_intent",
        "degradation": "ask_for_clarification",
        "preserveArtifacts": false,
        "retryAllowed": false,
        "stage": "intent_resolution",
        "userMessage": "请选择您想要执行的操作",
      }
    `);
  });

  it('maps stale patch to abort without apply', () => {
    const result = policy.evaluate('patch_reconciliation', 'stale_patch');
    expect(result.degradation).toBe('abort_without_apply');
    expect(result.preserveArtifacts).toBe(true);
  });

  it('maps retrieval failure to fallback_to_plain_draft', () => {
    const result = policy.evaluate('retrieval', 'retrieval_failed_or_empty');
    expect(result.degradation).toBe('fallback_to_plain_draft');
  });

  it('returns ultimate fallback for unknown stage', () => {
    const result = policy.evaluate('unknown_stage' as any);
    expect(result.degradation).toBe('fallback_to_chat_message');
    expect(result.preserveArtifacts).toBe(true);
  });
});
