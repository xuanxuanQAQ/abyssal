import { CopilotRuntime } from '../runtime';
import type { CopilotRuntimeDeps } from '../runtime';
import { makeContext } from './helpers';

async function* makeStream() {
  yield { type: 'text_delta', delta: 'hello' };
  yield {
    type: 'message_end',
    text: 'hello',
    usage: { inputTokens: 5, outputTokens: 2 },
    finishReason: 'end_turn',
  };
}

function makeDeps(): CopilotRuntimeDeps {
  return {
    context: {
      session: {
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
      } as any,
      workspaceId: 'ws-test',
    },
    agent: {
      llmClient: {
        completeStream: vi.fn().mockImplementation(() => makeStream()),
      } as any,
      capabilities: {
        toToolDefinitions: vi.fn().mockReturnValue([]),
        execute: vi.fn(),
      } as any,
      session: {} as any,
      eventBus: {} as any,
      governor: {
        reset: vi.fn(),
        canCallTool: vi.fn().mockReturnValue({ allowed: true }),
        recordCall: vi.fn(),
      } as any,
      buildSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
    },
    retrieval: {
      ragSearch: vi.fn().mockResolvedValue([]),
    },
    editor: {
      reconcile: vi.fn().mockResolvedValue({ ok: true }),
      applyPatch: vi.fn().mockResolvedValue(undefined),
      persistDocument: vi.fn().mockResolvedValue(undefined),
    },
    workflow: {
      startWorkflow: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
    },
    navigation: {
      navigate: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('CopilotRuntime', () => {
  it('records terminal operation status after execute completes', async () => {
    const runtime = new CopilotRuntime(makeDeps());

    await runtime.execute({
      operation: {
        id: 'op-runtime-1',
        sessionId: 'sess-runtime-1',
        surface: 'chat',
        intent: 'ask',
        prompt: 'hello',
        context: makeContext(),
        outputTarget: { type: 'chat-message' },
      },
    });

    expect(runtime.getOperationStatus('op-runtime-1')?.status).toBe('completed');
  });

  it('stores emitted events in the session timeline', async () => {
    const runtime = new CopilotRuntime(makeDeps());

    await runtime.execute({
      operation: {
        id: 'op-runtime-2',
        sessionId: 'sess-runtime-2',
        surface: 'chat',
        intent: 'ask',
        prompt: 'hello again',
        context: makeContext(),
        outputTarget: { type: 'chat-message' },
      },
    });

    const session = runtime.getSession('sess-runtime-2');
    expect(session?.timeline.map((event) => event.type)).toEqual(
      expect.arrayContaining(['operation.started', 'operation.completed']),
    );
  });
});