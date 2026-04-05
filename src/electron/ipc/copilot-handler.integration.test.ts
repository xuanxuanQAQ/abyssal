import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityRegistry } from '../../adapter/capabilities';
import type { StreamChunk, ToolDefinition } from '../../adapter/llm-client/llm-client';
import { createTestConfig, createTestDB, silentLogger } from '../../__test-utils__/test-db';
import { DatabaseService } from '../../core/database';
import { EventBus } from '../../core/event-bus';
import { ResearchSession } from '../../core/session/research-session';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();
const buildChatSystemPromptMock = vi.fn().mockResolvedValue('You are a test assistant.');

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

vi.mock('../chat-system-prompt', () => ({
  buildChatSystemPrompt: (...args: any[]) => buildChatSystemPromptMock(...args),
}));

import { invalidateCopilotRuntime, registerCopilotHandlers } from './copilot-handler';

function makeContextSnapshot() {
  return {
    activeView: 'library',
    focusEntities: { paperIds: [], conceptIds: [] },
    selection: null,
    conversation: { recentTurns: [] },
    retrieval: { evidence: [] },
    writing: null,
    budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] },
    frozenAt: Date.now(),
  } as const;
}

async function* streamChunks(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('copilot-handler integration — AI note creation', () => {
  let dbService: DatabaseService;

  beforeEach(() => {
    invalidateCopilotRuntime();
    registeredHandlers.clear();
    buildChatSystemPromptMock.mockClear();

    const db = createTestDB();
    dbService = new DatabaseService(
      db,
      createTestConfig(),
      silentLogger,
      ':memory:',
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    dbService.raw.close();
    invalidateCopilotRuntime();
    registeredHandlers.clear();
  });

  it('creates a note through copilot:execute and persists it via the notes capability', async () => {
    const eventBus = new EventBus();
    const session = new ResearchSession();
    session.focus.activePapers = ['paper-active-1'];
    session.focus.activeConcepts = ['concept-active-1'];

    const noteCreatedEvents: Array<Record<string, unknown>> = [];
    eventBus.on('data:noteCreated', (event) => {
      noteCreatedEvents.push(event as unknown as Record<string, unknown>);
    });

    const capabilityRegistry = createCapabilityRegistry(
      session,
      eventBus,
      {
        dbProxy: dbService,
        searchService: null,
        ragService: null,
        orchestrator: null,
        pushManager: null,
        confirmWrite: null,
        configProvider: null,
        apiDiagnostics: null,
      } as any,
      vi.fn(),
    );

    const llmClient = {
      completeStream: vi.fn()
        .mockImplementationOnce((params: { tools?: ToolDefinition[] }) => {
          expect(params.tools?.some((tool) => tool.name === 'notes--create')).toBe(true);

          return streamChunks([
            { type: 'tool_use_start', id: 'tool-1', name: 'notes--create' },
            {
              type: 'tool_use_end',
              id: 'tool-1',
              name: 'notes--create',
              input: {
                title: '电力市场研究笔记',
                content: '# 电力市场研究\n\n这里是一段由 AI 生成的测试笔记内容。',
              },
            },
            {
              type: 'message_end',
              text: '',
              usage: { inputTokens: 32, outputTokens: 11 },
              finishReason: 'tool_use',
            },
          ]);
        })
        .mockImplementationOnce(() => streamChunks([
          { type: 'text_delta', delta: '笔记已创建。' },
          {
            type: 'message_end',
            text: '笔记已创建。',
            usage: { inputTokens: 18, outputTokens: 6 },
            finishReason: 'end_turn',
          },
        ])),
    } as any;

    const pushCopilotEvent = vi.fn();
    const pushCopilotSessionChanged = vi.fn();

    registerCopilotHandlers({
      llmClient,
      capabilityRegistry,
      session,
      eventBus,
      workspaceRoot: '/test-workspace',
      dbProxy: dbService,
      pushManager: {
        pushCopilotEvent,
        pushCopilotSessionChanged,
        pushAiCommand: vi.fn(),
      },
      logger: silentLogger,
      orchestrator: null,
      ragModule: null,
      configProvider: {
        config: {
          language: { defaultOutputLanguage: 'zh-CN' },
          project: { name: 'Test Workspace' },
        },
      },
    } as any);

    const executeHandler = registeredHandlers.get('copilot:execute');
    const getSessionHandler = registeredHandlers.get('copilot:getSession');

    expect(executeHandler).toBeDefined();
    expect(getSessionHandler).toBeDefined();

    const envelope = {
      operation: {
        id: 'op-note-create',
        sessionId: 'sess-note-create',
        surface: 'chat',
        intent: 'ask',
        prompt: '帮我随便写一段关于电力市场研究的内容，并创建一条笔记。',
        context: makeContextSnapshot(),
        outputTarget: { type: 'chat-message' },
      },
    };

    const result = await executeHandler?.({} as any, envelope);
    expect(result).toEqual({
      operationId: 'op-note-create',
      sessionId: 'sess-note-create',
    });

    const notes = dbService.getAllNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe('电力市场研究笔记');
    expect(notes[0]?.linkedPaperIds).toEqual(['paper-active-1']);
    expect(notes[0]?.linkedConceptIds).toEqual(['concept-active-1']);
    expect(notes[0]?.documentJson).toContain('电力市场研究');

    expect(noteCreatedEvents).toHaveLength(1);
    expect(noteCreatedEvents[0]).toMatchObject({
      type: 'data:noteCreated',
      title: '电力市场研究笔记',
      linkedPaperIds: ['paper-active-1'],
      linkedConceptIds: ['concept-active-1'],
    });
    expect(notes[0]?.filePath).toBe(`__db__/${String(noteCreatedEvents[0]?.['noteId'] ?? '')}`);

    expect(pushCopilotEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool.call',
      toolName: 'notes--create',
      status: 'completed',
    }));
    expect(pushCopilotEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operation.completed',
      operationId: 'op-note-create',
    }));

    const sessionState = await getSessionHandler?.({} as any, 'sess-note-create');
    expect(sessionState?.timeline.some((event: Record<string, unknown>) => (
      event.type === 'tool.call' &&
      event.toolName === 'notes--create' &&
      event.status === 'completed'
    ))).toBe(true);
    expect(sessionState?.timeline.some((event: Record<string, unknown>) => (
      event.type === 'model.delta' && event.text === '笔记已创建。'
    ))).toBe(true);

    expect(llmClient.completeStream).toHaveBeenCalledTimes(2);
    expect(pushCopilotSessionChanged).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-note-create',
      operationId: 'op-note-create',
    }));
  });
});