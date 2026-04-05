import { ConfirmationEvaluator } from '../../../src/copilot-runtime/confirmation';
import type { ExecutionCoordinatorDeps } from '../../../src/copilot-runtime/execution-coordinator';
import { ExecutionCoordinator } from '../../../src/copilot-runtime/execution-coordinator';
import { OperationEventEmitter } from '../../../src/copilot-runtime/event-emitter';
import { FailurePolicyEvaluator } from '../../../src/copilot-runtime/failure-policy';
import { IdempotencyGuard } from '../../../src/copilot-runtime/idempotency-guard';
import { IntentRouter } from '../../../src/copilot-runtime/intent-router';
import { RecipeRegistry } from '../../../src/copilot-runtime/recipe-registry';
import { CopilotSessionManager } from '../../../src/copilot-runtime/session-manager';
import { TraceStore } from '../../../src/copilot-runtime/trace-store';
import type { CopilotOperation, CopilotOperationEnvelope, ContextSnapshot } from '../../../src/copilot-runtime/types';
import { makeContext, makeOperation, makeRecipe, resetSeq } from '../../../src/copilot-runtime/__tests__/helpers';

function makeEnvelope(opOverrides?: Partial<CopilotOperation>): CopilotOperationEnvelope {
  return { operation: makeOperation(opOverrides) };
}

function makeMockContextBuilder() {
  return {
    build: vi.fn().mockImplementation(async (op: CopilotOperation) => op.context ?? makeContext()),
  };
}

function makeMockAgentExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({
      text: 'LLM response text',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

function makeDeps(overrides?: Partial<ExecutionCoordinatorDeps>): ExecutionCoordinatorDeps {
  const emitter = new OperationEventEmitter();
  const sessionManager = new CopilotSessionManager();
  emitter.on((event) => sessionManager.appendEvent(event));

  const registry = new RecipeRegistry();
  registry.register(makeRecipe({
    id: 'test-recipe',
    intents: ['ask'],
    priority: 5,
    specificity: 5,
    matchReturn: true,
  }));

  return {
    router: new IntentRouter(),
    contextBuilder: makeMockContextBuilder() as any,
    recipeRegistry: registry,
    emitter,
    traceStore: new TraceStore(),
    sessionManager,
    idempotencyGuard: new IdempotencyGuard(),
    confirmationEvaluator: new ConfirmationEvaluator(),
    failurePolicy: new FailurePolicyEvaluator(),
    agentExecutor: makeMockAgentExecutor() as any,
    retrievalExecutor: { execute: vi.fn() } as any,
    editorExecutor: { execute: vi.fn() } as any,
    workflowExecutor: { execute: vi.fn() } as any,
    navigationExecutor: { execute: vi.fn() } as any,
    ...overrides,
  };
}

describe('ExecutionCoordinator robustness', () => {
  beforeEach(() => {
    resetSeq();
    vi.clearAllMocks();
  });

  it('aborts before executing plan when aborted during context build', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator({
      ...deps,
      contextBuilder: {
        build: vi.fn().mockImplementation(async (op: CopilotOperation) => {
          coordinator.abort(op.id);
          return op.context ?? makeContext();
        }),
      } as any,
    });
    const events: string[] = [];
    deps.emitter.on((event) => events.push(event.type));

    const result = await coordinator.execute(makeEnvelope({ id: 'op-abort-context', prompt: 'hello' }));

    expect(result.operationId).toBe('op-abort-context');
    expect(deps.agentExecutor.execute).not.toHaveBeenCalled();
    expect(events).toContain('operation.aborted');
    expect(deps.sessionManager.getOperationStatus('op-abort-context')?.status).toBe('aborted');
    expect(deps.traceStore.getSummaries(1)[0]?.status).toBe('aborted');
  });

  it('aborts after executor returns when signal is raised mid-execution', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator(deps);
    const events: string[] = [];
    deps.emitter.on((event) => events.push(event.type));

    (deps.agentExecutor.execute as any).mockImplementation(async (op: CopilotOperation) => {
      coordinator.abort(op.id);
      return {
        text: 'partial text',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });

    const result = await coordinator.execute(makeEnvelope({ id: 'op-abort-exec', prompt: 'hello' }));

    expect(result.operationId).toBe('op-abort-exec');
    expect(deps.agentExecutor.execute).toHaveBeenCalledTimes(1);
    expect(events).toContain('operation.aborted');
    expect(events).not.toContain('operation.completed');
  });

  it('deduplicates repeated submissions within the idempotency window', async () => {
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
      context: makeContext(),
    }));

    expect(result1.operationId).toBe('op-first');
    expect(result2.operationId).toBe('op-first');
    expect(deps.agentExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('records failed operation state and keeps status queryable after executor error', async () => {
    const deps = makeDeps();
    const coordinator = new ExecutionCoordinator(deps);
    (deps.agentExecutor.execute as any).mockRejectedValue(new Error('LLM down'));

    const result = await coordinator.execute(makeEnvelope({ id: 'op-failed', sessionId: 'sess-failed' }));

    expect(result.operationId).toBe('op-failed');
    const status = deps.sessionManager.getOperationStatus('op-failed');
    expect(status?.status).toBe('failed');
    expect(deps.traceStore.getSummaries(1)[0]?.status).toBe('failed');
  });
});
