/**
 * Copilot handler — conversation cache & dependency injection contract tests.
 *
 * Validates that:
 * 1. getConversationTurns returns accumulated turns (not empty [])
 * 2. persistDocument emits a push command (not a no-op)
 * 3. buildSystemPrompt delegates to buildChatSystemPrompt (not hardcoded)
 * 4. Event listener accumulates assistant text from model.delta events
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Capture CopilotRuntimeDeps passed to CopilotRuntime constructor ───

let capturedDeps: any = null;
let capturedEventListener: ((event: any) => void) | null = null;
let capturedRuntimeInstance: any = null;

vi.mock('../../copilot-runtime/runtime', () => ({
  CopilotRuntime: vi.fn(function MockCopilotRuntime(this: any, deps: any) {
    capturedDeps = deps;
    capturedRuntimeInstance = this;
    this.onEvent = vi.fn((listener: (event: any) => void) => {
      capturedEventListener = listener;
    });
    this.execute = vi.fn().mockResolvedValue({ operationId: 'op-1', sessionId: 'sess-1' });
    this.abort = vi.fn();
    this.resume = vi.fn();
    this.getOperationStatus = vi.fn();
    this.listSessions = vi.fn().mockReturnValue([]);
    this.getSession = vi.fn();
    this.clearSession = vi.fn();
  }),
}));

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

const mockBuildChatSystemPrompt = vi.fn().mockResolvedValue('You are a research assistant.\n## Rules\n- Always respond in zh-CN');
vi.mock('../chat-system-prompt', () => ({
  buildChatSystemPrompt: (...args: any[]) => mockBuildChatSystemPrompt(...args),
}));

// Must import AFTER mocks
import { registerCopilotHandlers, invalidateCopilotRuntime } from './copilot-handler';

function makeCtx(overrides?: Record<string, unknown>) {
  return {
    llmClient: { completeStream: vi.fn() },
    capabilityRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
    session: { focus: { currentView: 'library', activePapers: [], activeConcepts: [], selected: {}, readerState: null } },
    eventBus: {},
    workspaceRoot: '/test',
    dbProxy: { getArticle: vi.fn(), getChatHistory: vi.fn().mockResolvedValue([]) },
    pushManager: {
      pushCopilotEvent: vi.fn(),
      pushCopilotSessionChanged: vi.fn(),
      pushAiCommand: vi.fn(),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    orchestrator: null,
    ragModule: null,
    configProvider: {
      config: { language: { defaultOutputLanguage: 'zh-CN' }, project: { name: 'Test' } },
    },
    ...overrides,
  } as any;
}

describe('copilot-handler — dependency injection contracts', () => {
  let ctx: any;
  let seq: number;

  beforeEach(() => {
    invalidateCopilotRuntime();
    capturedDeps = null;
    capturedEventListener = null;
    capturedRuntimeInstance = null;
    registeredHandlers.clear();
    mockBuildChatSystemPrompt.mockClear();
    ctx = makeCtx();
    seq = 0;
    registerCopilotHandlers(ctx);
  });

  function triggerRuntimeInit() {
    seq += 1;
    const operationId = `op-init-${seq}`;
    const sessionId = `sess-${seq}`;
    // Trigger getRuntime by calling copilot:execute
    const handler = registeredHandlers.get('copilot:execute');
    const promise = handler?.({} as any, {
      operation: {
        id: operationId,
        sessionId,
        surface: 'chat',
        intent: 'ask',
        prompt: 'Hello',
        context: {
          activeView: 'library',
          focusEntities: { paperIds: [], conceptIds: [] },
          selection: null,
          conversation: { recentTurns: [] },
          retrieval: { evidence: [] },
          writing: null,
          budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] },
          frozenAt: Date.now(),
        },
        outputTarget: { type: 'chat-message' },
      },
    });
    return { promise, operationId, sessionId };
  }

  // ── getConversationTurns ──

  describe('getConversationTurns', () => {
    it('hydrates persisted turns before execution after restart', async () => {
      const persistedTurns = [
        { id: 'm2', role: 'assistant', content: 'Earlier answer', timestamp: 2 },
        { id: 'm1', role: 'user', content: 'Earlier question', timestamp: 1 },
      ];
      ctx = makeCtx({
        dbProxy: {
          getArticle: vi.fn(),
          getChatHistory: vi.fn().mockResolvedValue(persistedTurns),
        },
      });
      registerCopilotHandlers(ctx);

      const { promise, sessionId } = triggerRuntimeInit();
      await promise;

      const turns = capturedDeps.context.getConversationTurns(sessionId, 10);
      expect(turns).toEqual([
        { role: 'user', text: 'Earlier question' },
        { role: 'assistant', text: 'Earlier answer' },
        { role: 'user', text: 'Hello' },
      ]);
    });

    it('returns empty array for a fresh session', async () => {
      await triggerRuntimeInit().promise;
      const turns = capturedDeps.context.getConversationTurns('unknown-session', 10);
      expect(turns).toEqual([]);
    });

    it('returns accumulated turns after copilot:execute + events', async () => {
      const { promise, operationId, sessionId } = triggerRuntimeInit();
      await promise;

      // copilot:execute pushes user turn + sets operationMeta
      // Now simulate model.delta + operation.completed events
      capturedEventListener?.({
        type: 'model.delta',
        operationId,
        channel: 'chat',
        text: 'Hi there! ',
        sequence: 1,
        emittedAt: Date.now(),
      });
      capturedEventListener?.({
        type: 'model.delta',
        operationId,
        channel: 'chat',
        text: 'How can I help?',
        sequence: 2,
        emittedAt: Date.now(),
      });
      capturedEventListener?.({
        type: 'operation.completed',
        operationId,
        sequence: 3,
        emittedAt: Date.now(),
      });

      // Now getConversationTurns should have [user, assistant]
      const turns = capturedDeps.context.getConversationTurns(sessionId, 10);
      expect(turns).toHaveLength(2);
      expect(turns[0]).toEqual({ role: 'user', text: 'Hello' });
      expect(turns[1]).toEqual({ role: 'assistant', text: 'Hi there! How can I help?' });
    });

    it('respects limit parameter', async () => {
      const { promise, operationId, sessionId } = triggerRuntimeInit();
      await promise;

      // Simulate 3 rounds of conversation by directly triggering turns
      // Round 1 was already pushed by triggerRuntimeInit (user: Hello)
      capturedEventListener?.({
        type: 'model.delta',
        operationId,
        channel: 'chat',
        text: 'Response 1',
        sequence: 1,
        emittedAt: Date.now(),
      });
      capturedEventListener?.({
        type: 'operation.completed',
        operationId,
        sequence: 2,
        emittedAt: Date.now(),
      });

      // Round 2 via copilot:execute
      const handler = registeredHandlers.get('copilot:execute');
      await handler?.({} as any, {
        operation: {
          id: 'op-2',
          sessionId,
          prompt: 'Tell me more',
          surface: 'chat',
          intent: 'ask',
          context: { activeView: 'library', focusEntities: { paperIds: [], conceptIds: [] }, selection: null, conversation: { recentTurns: [] }, retrieval: { evidence: [] }, writing: null, budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] }, frozenAt: Date.now() },
          outputTarget: { type: 'chat-message' },
        },
      });
      capturedEventListener?.({ type: 'model.delta', operationId: 'op-2', channel: 'chat', text: 'Response 2', sequence: 3, emittedAt: Date.now() });
      capturedEventListener?.({ type: 'operation.completed', operationId: 'op-2', sequence: 4, emittedAt: Date.now() });

      // Should have 4 turns: user1, assistant1, user2, assistant2
      const all = capturedDeps.context.getConversationTurns(sessionId, 10);
      expect(all).toHaveLength(4);

      // Limit=2 should return last 2 turns
      const limited = capturedDeps.context.getConversationTurns(sessionId, 2);
      expect(limited).toHaveLength(2);
      expect(limited[0].text).toBe('Tell me more');
      expect(limited[1].text).toBe('Response 2');
    });
  });

  // ── buildSystemPrompt ──

  describe('buildSystemPrompt', () => {
    it('delegates to buildChatSystemPrompt instead of returning hardcoded string', async () => {
      await triggerRuntimeInit().promise;

      const operation = {
        id: 'op-test',
        sessionId: 'sess-1',
        surface: 'chat',
        intent: 'ask',
        prompt: 'Test',
        context: {
          activeView: 'library',
          focusEntities: { paperIds: ['p-1'], conceptIds: [] },
          selection: null,
        },
        outputTarget: { type: 'chat-message' },
      };

      const result = await capturedDeps.agent.buildSystemPrompt(operation);

      expect(mockBuildChatSystemPrompt).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          activeView: 'library',
          selectedPaperId: 'p-1',
        }),
        expect.objectContaining({
          bundles: ['project_meta', 'active_focus', 'working_memory_light'].filter(
            (bundle) => bundle === 'project_meta' || bundle === 'active_focus' || bundle === 'capability_hints',
          ),
          interactionMode: 'default',
        }),
      );
      expect(result).toContain('zh-CN');
      expect(result).not.toBe('You are a research writing assistant.');
    });

    it('uses greeting interaction mode for a plain hello', async () => {
      await triggerRuntimeInit().promise;

      await capturedDeps.agent.buildSystemPrompt({
        id: 'op-greeting',
        sessionId: 'sess-1',
        surface: 'chat',
        intent: 'ask',
        prompt: '你好',
        context: {
          activeView: 'library',
          focusEntities: { paperIds: [], conceptIds: [] },
          selection: null,
        },
        outputTarget: { type: 'chat-message' },
      });

      expect(mockBuildChatSystemPrompt).toHaveBeenLastCalledWith(
        ctx,
        expect.objectContaining({ activeView: 'library' }),
        expect.objectContaining({ bundles: [], interactionMode: 'greeting' }),
      );
    });

    it('uses assistant-profile interaction mode for identity questions', async () => {
      await triggerRuntimeInit().promise;

      await capturedDeps.agent.buildSystemPrompt({
        id: 'op-profile',
        sessionId: 'sess-1',
        surface: 'chat',
        intent: 'ask',
        prompt: '你是谁？',
        context: {
          activeView: 'library',
          focusEntities: { paperIds: [], conceptIds: [] },
          selection: null,
        },
        outputTarget: { type: 'chat-message' },
      });

      expect(mockBuildChatSystemPrompt).toHaveBeenLastCalledWith(
        ctx,
        expect.objectContaining({ activeView: 'library' }),
        expect.objectContaining({
          bundles: ['project_meta', 'capability_hints'],
          interactionMode: 'assistant_profile',
        }),
      );
    });
  });

  // ── editor.persistDocument ──

  describe('editor.persistDocument', () => {
    it('pushes an AI command (not a no-op)', async () => {
      await triggerRuntimeInit().promise;

      await capturedDeps.editor.persistDocument('article-1', 'section-2');

      expect(ctx.pushManager.pushAiCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'persist-document',
          articleId: 'article-1',
          sectionId: 'section-2',
        }),
      );
    });
  });

  describe('editor.applyPatch', () => {
    it('dispatches only the AI command and avoids malformed copilot patch events', async () => {
      await triggerRuntimeInit().promise;

      const patch = {
        kind: 'replace-range',
        editorId: 'main',
        from: 0,
        to: 5,
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      };

      await capturedDeps.editor.applyPatch(patch);

      expect(ctx.pushManager.pushAiCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'apply-editor-patch',
          patch,
        }),
      );
      expect(ctx.pushManager.pushCopilotEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'patch.proposed',
        }),
      );
    });
  });

  // ── Event listener: assistant text accumulation ──

  describe('event listener — conversation assembly', () => {
    it('pushes copilotSessionChanged with the concrete session id on completion', async () => {
      const { promise, operationId, sessionId } = triggerRuntimeInit();
      await promise;

      capturedEventListener?.({
        type: 'operation.completed',
        operationId,
        sequence: 1,
        emittedAt: Date.now(),
      });

      expect(ctx.pushManager.pushCopilotSessionChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          operationId,
        }),
      );
    });

    it('does not push assistant turn for aborted operations', async () => {
      const { promise, operationId, sessionId } = triggerRuntimeInit();
      await promise;

      capturedEventListener?.({ type: 'model.delta', operationId, channel: 'chat', text: 'Partial...', sequence: 1, emittedAt: Date.now() });
      capturedEventListener?.({ type: 'operation.aborted', operationId, sequence: 2, emittedAt: Date.now() });

      // Only the user turn should be present (no partial assistant)
      const turns = capturedDeps.context.getConversationTurns(sessionId, 10);
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe('user');
    });

    it('ignores draft channel deltas for conversation cache', async () => {
      const { promise, operationId, sessionId } = triggerRuntimeInit();
      await promise;

      // Draft channel deltas should not affect conversation cache
      capturedEventListener?.({ type: 'model.delta', operationId, channel: 'draft', text: 'Draft text', sequence: 1, emittedAt: Date.now() });
      capturedEventListener?.({ type: 'operation.completed', operationId, sequence: 2, emittedAt: Date.now() });

      const turns = capturedDeps.context.getConversationTurns(sessionId, 10);
      // Should only have user turn (draft text should not become assistant turn)
      expect(turns).toHaveLength(1);
    });
  });
});
