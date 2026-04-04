import { CopilotRuntime } from '../../src/copilot-runtime/runtime';
import type { CopilotRuntimeDeps } from '../../src/copilot-runtime/runtime';
import { makeContext } from '../../src/copilot-runtime/__tests__/helpers';

async function* makeStream() {
  yield { type: 'text_delta', delta: 'hello ' } as const;
  yield { type: 'text_delta', delta: 'world' } as const;
  yield {
    type: 'message_end',
    text: 'hello world',
    usage: { inputTokens: 5, outputTokens: 2 },
    finishReason: 'end_turn',
  } as const;
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
      workspaceId: 'ws-integration',
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

describe('copilot runtime flow integration', () => {
  it('runs intent -> context -> recipe -> executor -> result with a stable event sequence', async () => {
    const runtime = new CopilotRuntime(makeDeps());
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));

    const result = await runtime.execute({
      operation: {
        id: 'op-flow-1',
        sessionId: 'sess-flow-1',
        surface: 'chat',
        intent: 'ask',
        prompt: 'summarize the current state',
        context: makeContext(),
        outputTarget: { type: 'chat-message' },
      },
    });

    expect(result.operationId).toBe('op-flow-1');
    expect(events).toEqual([
      'operation.started',
      'context.resolved',
      'planning.finished',
      'model.delta',
      'model.delta',
      'operation.completed',
    ]);
    expect(runtime.getOperationStatus('op-flow-1')?.status).toBe('completed');
    expect(runtime.getTraceSummaries(1)[0]?.status).toBe('completed');
  });

  it('writes the same stable flow into the session timeline for downstream UI consumers', async () => {
    const runtime = new CopilotRuntime(makeDeps());

    await runtime.execute({
      operation: {
        id: 'op-flow-2',
        sessionId: 'sess-flow-2',
        surface: 'chat',
        intent: 'ask',
        prompt: 'what changed in this draft?',
        context: makeContext(),
        outputTarget: { type: 'chat-message' },
      },
    });

    const timelineTypes = runtime.getSession('sess-flow-2')?.timeline.map((event) => event.type);

    expect(timelineTypes).toEqual([
      'operation.started',
      'context.resolved',
      'planning.finished',
      'model.delta',
      'model.delta',
      'operation.completed',
    ]);
  });
});