import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOrchestrator } from './session-orchestrator';
import type { ChatContext } from '../../shared-types/ipc';

function makeChatContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    activeView: 'library',
    contextKey: 'global',
    ...overrides,
  };
}

async function* completeWithoutTools(text = 'ok') {
  yield { type: 'text_delta', delta: text };
  yield {
    type: 'message_end',
    text,
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: 'end_turn',
  };
}

function makeOrchestrator() {
  const buildContextForPrompt = vi.fn((_opts?: Record<string, unknown>) => '');

  const session = {
    focus: {
      currentView: 'library',
      activePapers: [],
      activeConcepts: [],
      readerState: null,
      selected: {
        paperId: null,
        conceptId: null,
        noteId: null,
        articleId: null,
      },
    },
    memory: {
      purgeStaleObservations: vi.fn(),
    },
    buildContextForPrompt,
  };

  const llmClient = {
    completeStream: vi.fn(() => completeWithoutTools()),
  };

  const capabilities = {
    toToolDefinitions: vi.fn(() => []),
    execute: vi.fn(),
  };

  const eventBus = {
    onAny: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };

  const buildSystemPrompt = vi.fn(async () => 'SYS');
  const logger = vi.fn();

  const orchestrator = new SessionOrchestrator({
    eventBus: eventBus as any,
    session: session as any,
    capabilities: capabilities as any,
    llmClient: llmClient as any,
    pushManager: null,
    buildSystemPrompt,
    logger,
  });

  return {
    orchestrator,
    buildContextForPrompt,
  };
}

describe('SessionOrchestrator short-term context isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses recent selection within the same conversation', async () => {
    const { orchestrator, buildContextForPrompt } = makeOrchestrator();

    await orchestrator.handleUserMessage(
      '这段在说什么？',
      makeChatContext({ selectedQuote: 'selected text' }),
      undefined,
      'chat:a',
    );

    await orchestrator.handleUserMessage(
      '分析这篇论文的方法设计',
      makeChatContext(),
      undefined,
      'chat:a',
    );

    expect(buildContextForPrompt.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondCallOpts = buildContextForPrompt.mock.calls[1]![0] as Record<string, unknown>;
    expect(secondCallOpts.includeSelectionContext).toBe(true);
  });

  it('does not leak recent selection across conversations', async () => {
    const { orchestrator, buildContextForPrompt } = makeOrchestrator();

    await orchestrator.handleUserMessage(
      '这段在说什么？',
      makeChatContext({ selectedQuote: 'selected text' }),
      undefined,
      'chat:a',
    );

    await orchestrator.handleUserMessage(
      '分析这篇论文的方法设计',
      makeChatContext(),
      undefined,
      'chat:b',
    );

    expect(buildContextForPrompt.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondCallOpts = buildContextForPrompt.mock.calls[1]![0] as Record<string, unknown>;
    expect(secondCallOpts.includeSelectionContext).toBe(false);
  });

  it('clearing a conversation also clears its short-term state', async () => {
    const { orchestrator, buildContextForPrompt } = makeOrchestrator();

    await orchestrator.handleUserMessage(
      '这段在说什么？',
      makeChatContext({ selectedQuote: 'selected text' }),
      undefined,
      'chat:a',
    );

    orchestrator.clearConversation('chat:a');

    await orchestrator.handleUserMessage(
      '分析这篇论文的方法设计',
      makeChatContext(),
      undefined,
      'chat:a',
    );

    expect(buildContextForPrompt.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondCallOpts = buildContextForPrompt.mock.calls[1]![0] as Record<string, unknown>;
    expect(secondCallOpts.includeSelectionContext).toBe(false);
  });

  it('clearConversation() without args clears all conversations short-term state', async () => {
    const { orchestrator, buildContextForPrompt } = makeOrchestrator();

    await orchestrator.handleUserMessage(
      '这段在说什么？',
      makeChatContext({ selectedQuote: 'selected text a' }),
      undefined,
      'chat:a',
    );

    await orchestrator.handleUserMessage(
      '这段在说什么？',
      makeChatContext({ selectedQuote: 'selected text b' }),
      undefined,
      'chat:b',
    );

    orchestrator.clearConversation();

    await orchestrator.handleUserMessage(
      '分析这篇论文的方法设计',
      makeChatContext(),
      undefined,
      'chat:a',
    );

    await orchestrator.handleUserMessage(
      '分析这篇论文的方法设计',
      makeChatContext(),
      undefined,
      'chat:b',
    );

    expect(buildContextForPrompt.mock.calls.length).toBeGreaterThanOrEqual(4);
    const thirdCallOpts = buildContextForPrompt.mock.calls[2]![0] as Record<string, unknown>;
    const fourthCallOpts = buildContextForPrompt.mock.calls[3]![0] as Record<string, unknown>;

    expect(thirdCallOpts.includeSelectionContext).toBe(false);
    expect(fourthCallOpts.includeSelectionContext).toBe(false);
  });

  it('filters tool definitions by routed family for provider diagnostics', async () => {
    const { orchestrator } = makeOrchestrator();
    const capabilities = (orchestrator as any).capabilities as {
      toToolDefinitions: ReturnType<typeof vi.fn>;
    };

    await orchestrator.handleUserMessage(
      '测试 Google API 是否可用',
      makeChatContext(),
      undefined,
      'chat:diag',
    );

    expect(capabilities.toToolDefinitions).toHaveBeenCalled();
    expect(capabilities.toToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ allowedFamilies: ['config_diagnostic', 'ui_navigation'] }),
    );
  });
});
