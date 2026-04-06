import { ExecutionCoordinator } from '../execution-coordinator';
import type { ExecutionCoordinatorDeps } from '../execution-coordinator';
import { IntentRouter } from '../intent-router';
import { RecipeRegistry } from '../recipe-registry';
import { OperationEventEmitter } from '../event-emitter';
import { TraceStore } from '../trace-store';
import { CopilotSessionManager } from '../session-manager';
import { IdempotencyGuard } from '../idempotency-guard';
import { ConfirmationEvaluator } from '../confirmation';
import { FailurePolicyEvaluator } from '../failure-policy';
import { makeOperation, makeContext, makeRecipe, makePlan, resetSeq } from './helpers';
import type { CopilotOperationEnvelope, CopilotOperation, ContextSnapshot } from '../types';

function makeEnvelope(opOverrides?: Partial<CopilotOperation>): CopilotOperationEnvelope {
  return { operation: makeOperation(opOverrides) };
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
      text: 'LLM response text',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

function makeMockRetrievalExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({
      evidence: [{ chunkId: 'c1', paperId: 'p1', text: 'evidence text', score: 0.9 }],
      query: 'test query',
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
    execute: vi.fn().mockResolvedValue({
      taskId: 'task-1',
      success: true,
    }),
  };
}

function makeMockNavigationExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      view: 'library',
    }),
  };
}

function makeDeps(overrides?: Partial<ExecutionCoordinatorDeps>): ExecutionCoordinatorDeps {
  const registry = new RecipeRegistry();
  // Register a default recipe that matches everything
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

describe('ExecutionCoordinator', () => {
  beforeEach(() => {
    resetSeq();
    vi.clearAllMocks();
  });

  describe('execute — happy path (ask intent)', () => {
    it('returns operationId and sessionId on success', async () => {
      const deps = makeDeps();
      const coordinator = new ExecutionCoordinator(deps);
      const envelope = makeEnvelope({ id: 'op-100', sessionId: 'sess-1', prompt: 'hello' });

      const result = await coordinator.execute(envelope);

      expect(result.operationId).toBe('op-100');
      expect(result.sessionId).toBe('sess-1');
    });

    it('calls context builder with routed operation', async () => {
      const deps = makeDeps();
      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ prompt: 'hello' }));

      expect(deps.contextBuilder.build).toHaveBeenCalled();
    });

    it('calls agent executor for llm_generate steps', async () => {
      const deps = makeDeps();
      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ prompt: 'hello' }));

      expect(deps.agentExecutor.execute).toHaveBeenCalled();
    });

    it('emits operation.started and operation.completed events', async () => {
      const deps = makeDeps();
      const events: any[] = [];
      deps.emitter.on((e) => events.push(e));
      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-1', prompt: 'hello' }));

      const types = events.map((e) => e.type);
      expect(types).toContain('operation.started');
      expect(types).toContain('operation.completed');
    });

    it('creates trace with phases', async () => {
      const deps = makeDeps();
      const coordinator = new ExecutionCoordinator(deps);
      const envelope = makeEnvelope({ id: 'op-1', prompt: 'hello' });
      await coordinator.execute(envelope);

      const trace = deps.traceStore.getTrace('op-1');
      expect(trace).toBeDefined();
      expect(trace!.phases.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('execute — idempotency', () => {
    it('returns existing operationId for duplicate operations', async () => {
      const deps = makeDeps();
      const coordinator = new ExecutionCoordinator(deps);

      const result1 = await coordinator.execute(makeEnvelope({
        id: 'op-dup',
        sessionId: 'sess-1',
        prompt: 'same prompt',
        surface: 'chat',
      }));

      // Same id should be idempotent (though normally it would be submitted once)
      const result2 = await coordinator.execute(makeEnvelope({
        id: 'op-dup',
        sessionId: 'sess-1',
        prompt: 'same prompt',
        surface: 'chat',
      }));

      expect(result2.operationId).toBe('op-dup');
    });
  });

  describe('execute — intent routing with keyword detection', () => {
    it('routes rewrite keyword to rewrite intent', async () => {
      const registry = new RecipeRegistry();
      registry.register(makeRecipe({
        id: 'rewrite',
        intents: ['rewrite-selection'],
        priority: 10,
        matchReturn: true,
      }));

      const deps = makeDeps({ recipeRegistry: registry });
      const coordinator = new ExecutionCoordinator(deps);
      const envelope = makeEnvelope({
        id: 'op-rw',
        prompt: '改写这段话',
        surface: 'editor-toolbar',
        context: makeContext({
          selection: { kind: 'editor', articleId: 'a', sectionId: 's', selectedText: 'hi', from: 0, to: 2 },
        }),
      });

      await coordinator.execute(envelope);
      // Should succeed without error
      expect(deps.agentExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('execute — recipe resolution failure → fallback to chat', () => {
    it('falls back to chat when no recipe matches', async () => {
      // Mock resolve to return 'no_match' — zero candidates trigger direct fallback
      const mockRegistry = {
        resolve: vi.fn().mockReturnValue({ selected: null, resolution: 'no_match', candidates: [] }),
        register: vi.fn(),
        unregister: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
      };

      const deps = makeDeps({ recipeRegistry: mockRegistry as any });
      const coordinator = new ExecutionCoordinator(deps);
      const result = await coordinator.execute(makeEnvelope({ id: 'op-fb', prompt: 'something weird' }));

      // Should still complete (fallback to chat)
      expect(result.operationId).toBe('op-fb');
      expect(deps.agentExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('execute — error handling', () => {
    it('emits operation.failed on unhandled error', async () => {
      const deps = makeDeps();
      (deps.agentExecutor.execute as any).mockRejectedValue(new Error('LLM down'));

      const events: any[] = [];
      deps.emitter.on((e) => events.push(e));

      const coordinator = new ExecutionCoordinator(deps);
      const result = await coordinator.execute(makeEnvelope({ id: 'op-err', prompt: 'hello' }));

      expect(result.operationId).toBe('op-err');

      const failEvent = events.find((e) => e.type === 'operation.failed');
      expect(failEvent).toBeDefined();
      expect(failEvent.message).toContain('LLM down');
    });

    it('finalizes trace as failed on error', async () => {
      const deps = makeDeps();
      (deps.agentExecutor.execute as any).mockRejectedValue(new Error('boom'));

      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-err2', prompt: 'hello' }));

      const summaries = deps.traceStore.getSummaries();
      const summary = summaries.find((s) => s.operationId === 'op-err2');
      expect(summary?.status).toBe('failed');
    });
  });

  describe('execute — retrieval step', () => {
    it('enriches context with retrieval results even when context is frozen', async () => {
      const registry = new RecipeRegistry();
      registry.register({
        id: 'with-retrieval',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'with-retrieval',
          target: { type: 'chat-message' },
          steps: [
            { kind: 'retrieve', query: 'find evidence', source: 'rag' },
            { kind: 'llm_generate', mode: 'chat' },
          ],
          confirmation: { mode: 'auto', reason: 'test', requiredFor: 'execution' },
        }),
      });

      // Return a frozen context — like the real ContextSnapshotBuilder does
      const frozenContext = Object.freeze(makeContext());
      const deps = makeDeps({ recipeRegistry: registry });
      (deps.contextBuilder.build as any).mockResolvedValue(frozenContext);

      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-frozen', prompt: 'find info' }));

      expect(deps.retrievalExecutor.execute).toHaveBeenCalled();
      expect(deps.agentExecutor.execute).toHaveBeenCalled();
      const routedOperation = (deps.agentExecutor.execute as any).mock.calls[0][0] as CopilotOperation;
      expect(routedOperation.context.retrieval.lastQuery).toBe('test query');
      expect(routedOperation.context.retrieval.evidence).toEqual([
        { chunkId: 'c1', paperId: 'p1', text: 'evidence text', score: 0.9 },
      ]);
    });

    it('enriches context with retrieval results', async () => {
      const registry = new RecipeRegistry();
      registry.register({
        id: 'with-retrieval',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'with-retrieval',
          target: { type: 'chat-message' },
          steps: [
            { kind: 'retrieve', query: 'find evidence', source: 'rag' },
            { kind: 'llm_generate', mode: 'chat' },
          ],
          confirmation: { mode: 'auto', reason: 'test', requiredFor: 'execution' },
        }),
      });

      const deps = makeDeps({ recipeRegistry: registry });
      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-ret', prompt: 'find info' }));

      expect(deps.retrievalExecutor.execute).toHaveBeenCalled();
      expect(deps.agentExecutor.execute).toHaveBeenCalled();
      const routedOperation = (deps.agentExecutor.execute as any).mock.calls[0][0] as CopilotOperation;
      expect(routedOperation.context.retrieval.lastQuery).toBe('test query');
      expect(routedOperation.context.retrieval.evidence).toEqual([
        { chunkId: 'c1', paperId: 'p1', text: 'evidence text', score: 0.9 },
      ]);
    });

    it('continues without evidence when retrieval fails and citation not required', async () => {
      const registry = new RecipeRegistry();
      registry.register({
        id: 'with-retrieval',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'with-retrieval',
          target: { type: 'chat-message' },
          steps: [
            { kind: 'retrieve', query: 'find evidence', source: 'rag' },
            { kind: 'llm_generate', mode: 'chat' },
          ],
          confirmation: { mode: 'auto', reason: 'test', requiredFor: 'execution' },
        }),
      });

      const deps = makeDeps({ recipeRegistry: registry });
      (deps.retrievalExecutor.execute as any).mockRejectedValue(new Error('search down'));

      const coordinator = new ExecutionCoordinator(deps);
      const result = await coordinator.execute(makeEnvelope({ id: 'op-ret-fail', prompt: 'check' }));

      // Should still succeed via fallback
      expect(result.operationId).toBe('op-ret-fail');
      expect(deps.agentExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('execute — editor patch step', () => {
    it('applies patch for editor output targets', async () => {
      const registry = new RecipeRegistry();
      registry.register({
        id: 'edit-recipe',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'edit-recipe',
          target: { type: 'editor-selection-replace', editorId: 'main', articleId: 'a', sectionId: 's', from: 0, to: 5 },
          steps: [
            { kind: 'llm_generate', mode: 'draft' },
            { kind: 'apply_patch', patchTarget: { type: 'editor-selection-replace', editorId: 'main', articleId: 'a', sectionId: 's', from: 0, to: 5 } },
          ],
          confirmation: { mode: 'preview', reason: 'test', requiredFor: 'execution' },
        }),
      });

      const deps = makeDeps({ recipeRegistry: registry });
      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-edit', prompt: 'rewrite' }));

      expect(deps.editorExecutor.execute).toHaveBeenCalled();
    });

    it('records degradation when patch reconciliation fails', async () => {
      const registry = new RecipeRegistry();
      registry.register({
        id: 'edit-recipe',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'edit-recipe',
          target: { type: 'editor-selection-replace', editorId: 'main', articleId: 'a', sectionId: 's', from: 0, to: 5 },
          steps: [
            { kind: 'llm_generate', mode: 'draft' },
            { kind: 'apply_patch', patchTarget: { type: 'editor-selection-replace', editorId: 'main', articleId: 'a', sectionId: 's', from: 0, to: 5 } },
          ],
          confirmation: { mode: 'preview', reason: 'test', requiredFor: 'execution' },
        }),
      });

      const deps = makeDeps({ recipeRegistry: registry });
      (deps.editorExecutor.execute as any).mockResolvedValue({
        applied: false,
        patch: {},
        reconciliation: { ok: false, reason: 'editor_changed' },
      });

      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-stale', prompt: 'rewrite' }));

      const trace = deps.traceStore.getTrace('op-stale');
      expect(trace?.degradations).toBeDefined();
      expect(trace!.degradations!.some((d) => d.stage === 'patch_reconciliation')).toBe(true);
    });
  });

  describe('execute — workflow step', () => {
    it('executes workflow via workflow executor', async () => {
      const registry = new RecipeRegistry();
      registry.register({
        id: 'wf-recipe',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'wf-recipe',
          target: { type: 'workflow', workflow: 'discover' },
          steps: [{ kind: 'run_workflow', workflow: 'discover' }],
          confirmation: { mode: 'explicit', reason: 'test', requiredFor: 'execution' },
        }),
      });

      const deps = makeDeps({ recipeRegistry: registry });
      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-wf', prompt: 'run workflow' }));

      expect(deps.workflowExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('execute — navigation step', () => {
    it('executes navigation via navigation executor', async () => {
      const registry = new RecipeRegistry();
      registry.register({
        id: 'nav-recipe',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'nav-recipe',
          target: { type: 'navigate', view: 'library' },
          steps: [{ kind: 'navigate', view: 'library' }],
          confirmation: { mode: 'auto', reason: 'test', requiredFor: 'execution' },
        }),
      });

      const deps = makeDeps({ recipeRegistry: registry });
      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-nav', prompt: 'go to library' }));

      expect(deps.navigationExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    it('emits operation.aborted event', async () => {
      const deps = makeDeps();
      const events: any[] = [];
      deps.emitter.on((e) => events.push(e));

      // Create a slow agent executor that we can abort
      let resolveAgent: (() => void) | undefined;
      (deps.agentExecutor.execute as any).mockImplementation(() => new Promise<any>((resolve) => {
        resolveAgent = () => resolve({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } });
      }));

      const coordinator = new ExecutionCoordinator(deps);
      const execPromise = coordinator.execute(makeEnvelope({ id: 'op-abort', prompt: 'hello' }));

      // Flush microtasks so execution reaches agentExecutor.execute
      await new Promise((r) => setTimeout(r, 0));

      // Abort mid-flight
      coordinator.abort('op-abort');

      // Resolve the agent so the promise settles
      resolveAgent!();
      await execPromise;

      const abortEvent = events.find((e) => e.type === 'operation.aborted');
      expect(abortEvent).toBeDefined();
    });

    it('keeps an aborted operation from transitioning into any other terminal state', async () => {
      const deps = makeDeps();
      const events: any[] = [];
      deps.emitter.on((e) => events.push(e));

      let resolveAgent: (() => void) | undefined;
      (deps.agentExecutor.execute as any).mockImplementation(() => new Promise<any>((resolve) => {
        resolveAgent = () => resolve({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } });
      }));

      const coordinator = new ExecutionCoordinator(deps);
      const execPromise = coordinator.execute(makeEnvelope({ id: 'op-abort-no-fail', prompt: 'hello' }));

      await new Promise((r) => setTimeout(r, 0));

      coordinator.abort('op-abort-no-fail');
      resolveAgent!();
      await execPromise;

      const terminalTypes = events
        .filter((e) => ['operation.completed', 'operation.aborted', 'operation.failed'].includes(e.type))
        .map((e) => e.type);

      expect(terminalTypes).toEqual(['operation.aborted']);

      const summaries = deps.traceStore.getSummaries().filter((s) => s.operationId === 'op-abort-no-fail');
      expect(summaries).toEqual([
        expect.objectContaining({
          operationId: 'op-abort-no-fail',
          status: 'aborted',
        }),
      ]);
    });
  });

  describe('resume', () => {
    it('throws when no pending clarification exists', async () => {
      const deps = makeDeps();
      const coordinator = new ExecutionCoordinator(deps);

      await expect(coordinator.resume({
        operationId: 'op-x',
        continuationToken: 'tok',
        selectedOptionId: 'opt',
      })).rejects.toThrow();
    });

    it('resumes a tracked operation with pending clarification', async () => {
      const deps = makeDeps();
      const coordinator = new ExecutionCoordinator(deps);

      const operation = makeOperation({
        id: 'op-resume',
        sessionId: 'sess-resume',
        prompt: 'ambiguous prompt',
      });
      deps.sessionManager.trackOperation(operation);
      deps.sessionManager.setPendingClarification('sess-resume', {
        operationId: 'op-resume',
        sessionId: 'sess-resume',
        question: 'Which one?',
        options: [{ id: 'rewrite-selection', label: 'Rewrite', targetIntent: 'rewrite-selection' }],
        resumeOperation: operation,
        continuationToken: 'tok-resume',
      });

      const result = await coordinator.resume({
        operationId: 'op-resume',
        continuationToken: 'tok-resume',
        selectedOptionId: 'rewrite-selection',
      });

      expect(result.operationId).toBe('op-resume');
      expect(deps.agentExecutor.execute).toHaveBeenCalled();
    });

    it('preserves the original prompt and latest built context when resuming after recipe clarification', async () => {
      const builtContext = makeContext({
        workspaceId: 'ws-built',
        retrieval: {
          evidence: [{ chunkId: 'c-built', paperId: 'p-built', text: 'built evidence', score: 0.95 }],
        },
        frozenAt: 4242,
      });

      const contextBuilder = {
        build: vi.fn()
          .mockResolvedValueOnce(builtContext)
          .mockImplementation(async (op: CopilotOperation) => op.context),
      };

      const selectedRecipe = {
        id: 'resolved-recipe',
        intents: ['ask'],
        priority: 10,
        specificity: 10,
        matches: () => true,
        buildPlan: async () => ({
          recipeId: 'resolved-recipe',
          target: { type: 'chat-message' },
          steps: [{ kind: 'llm_generate', mode: 'chat' }],
          confirmation: { mode: 'auto', reason: 'test', requiredFor: 'execution' },
        }),
      };

      const recipeRegistry = {
        resolve: vi.fn()
          .mockReturnValueOnce({
            selected: null,
            resolution: 'deferred_to_user',
            candidates: ['rewrite-choice'],
          })
          .mockReturnValue({
            selected: selectedRecipe,
            resolution: 'single_match',
            candidates: ['resolved-recipe'],
          }),
        register: vi.fn(),
        unregister: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
      };

      const deps = makeDeps({
        contextBuilder: contextBuilder as any,
        recipeRegistry: recipeRegistry as any,
      });
      const coordinator = new ExecutionCoordinator(deps);

      await coordinator.execute(makeEnvelope({
        id: 'op-resume-built',
        sessionId: 'sess-resume-built',
        prompt: 'please keep the original intent',
        context: makeContext({ workspaceId: 'ws-original', frozenAt: 1111 }),
      }));

      const session = deps.sessionManager.get('sess-resume-built');
      expect(session?.pendingClarification).toBeDefined();

      await coordinator.resume({
        operationId: 'op-resume-built',
        continuationToken: session!.pendingClarification!.continuationToken,
        selectedOptionId: 'rewrite-choice',
      });

      const resumedOperation = (deps.agentExecutor.execute as any).mock.calls[0][0] as CopilotOperation;
      expect.soft(resumedOperation.prompt).toBe('please keep the original intent');
      expect.soft(resumedOperation.context).toEqual(builtContext);
    });
  });

  describe('execute — ambiguous intent triggers clarification', () => {
    it('emits clarification-style events for ambiguous intents', async () => {
      const mockRouter = {
        classify: vi.fn().mockResolvedValue({
          intent: 'rewrite-selection',
          confidence: 0.7,
          outputTarget: { type: 'chat-message' },
          ambiguous: true,
          alternatives: [
            { intent: 'expand-selection', confidence: 0.68 },
          ],
        }),
      };

      const deps = makeDeps({ router: mockRouter as any });
      const events: any[] = [];
      deps.emitter.on((e) => events.push(e));

      const coordinator = new ExecutionCoordinator(deps);
      const result = await coordinator.execute(makeEnvelope({ id: 'op-ambig', prompt: 'ambiguous' }));

      expect(result.operationId).toBe('op-ambig');

      // Should have model.delta event with clarification text
      const deltaEvents = events.filter((e) => e.type === 'model.delta');
      expect(deltaEvents.length).toBeGreaterThan(0);
      expect(events.map((e) => e.type)).toContain('operation.clarification_required');
    });

    it('keeps the operation in clarification_required instead of completed', async () => {
      const mockRouter = {
        classify: vi.fn().mockResolvedValue({
          intent: 'rewrite-selection',
          confidence: 0.7,
          outputTarget: { type: 'chat-message' },
          ambiguous: true,
          alternatives: [
            { intent: 'expand-selection', confidence: 0.68 },
          ],
        }),
      };

      const deps = makeDeps({ router: mockRouter as any });
      const events: any[] = [];
      deps.emitter.on((e) => events.push(e));

      const coordinator = new ExecutionCoordinator(deps);
      await coordinator.execute(makeEnvelope({ id: 'op-clarify-state', sessionId: 'sess-clarify-state', prompt: 'ambiguous' }));

      expect(deps.sessionManager.getOperationStatus('op-clarify-state')?.status).toBe('clarification_required');
      expect(events.map((e) => e.type)).not.toContain('operation.completed');
    });
  });

  describe('cleanup', () => {
    it('releases idempotency fingerprint after execution', async () => {
      const idempotencyGuard = {
        checkDuplicate: vi.fn().mockReturnValue(null),
        register: vi.fn(),
        release: vi.fn(),
        cleanup: vi.fn(),
      } as any;

      const deps = makeDeps({ idempotencyGuard });
      const coordinator = new ExecutionCoordinator(deps);

      await coordinator.execute(makeEnvelope({ id: 'op-cleanup', prompt: 'hello' }));

      expect(idempotencyGuard.release).toHaveBeenCalledWith('op-cleanup');
    });
  });
});
