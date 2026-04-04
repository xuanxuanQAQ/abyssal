import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { CopilotOperationEnvelope, CopilotOperationEvent } from '../../../copilot-runtime/types';
import { useCopilotRuntime, type CopilotRuntimeHook } from './useCopilotRuntime';

const listeners = new Set<(event: unknown) => void>();
const executeMock = vi.fn();
const abortMock = vi.fn();
const resumeMock = vi.fn();
const getOperationStatusMock = vi.fn();
const listSessionsMock = vi.fn();
const getSessionMock = vi.fn();
const clearSessionMock = vi.fn();

vi.mock('../ipc/bridge', () => ({
  getAPI: () => ({
    copilot: {
      execute: executeMock,
      abort: abortMock,
      resume: resumeMock,
      getOperationStatus: getOperationStatusMock,
      listSessions: listSessionsMock,
      getSession: getSessionMock,
      clearSession: clearSessionMock,
    },
    on: {
      copilotEvent: (listener: (event: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  }),
}));

let latestHook: CopilotRuntimeHook | null = null;

function HookHarness() {
  latestHook = useCopilotRuntime();
  return null;
}

function emitEvent(event: CopilotOperationEvent) {
  for (const listener of listeners) {
    listener(event);
  }
}

describe('useCopilotRuntime', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    listeners.clear();
    latestHook = null;
    executeMock.mockReset();
    abortMock.mockReset();
    resumeMock.mockReset();
    getOperationStatusMock.mockReset();
    listSessionsMock.mockReset();
    getSessionMock.mockReset();
    clearSessionMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<HookHarness />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('preserves events that arrive before execute resolves', async () => {
    executeMock.mockImplementation(async (_envelope: CopilotOperationEnvelope) => {
      emitEvent({
        type: 'model.delta',
        operationId: 'op-1',
        channel: 'chat',
        text: 'prefetched text',
        sequence: 1,
        emittedAt: Date.now(),
      });
      emitEvent({
        type: 'operation.completed',
        operationId: 'op-1',
        sequence: 2,
        emittedAt: Date.now(),
      });
      return { operationId: 'op-1', sessionId: 'sess-1' };
    });

    await act(async () => {
      await latestHook!.execute({
        operation: {
          id: 'op-1',
          sessionId: 'sess-1',
          surface: 'chat',
          intent: 'ask',
          prompt: 'hello',
          context: {
            activeView: 'library',
            workspaceId: 'ws',
            article: null,
            selection: null,
            focusEntities: { paperIds: [], conceptIds: [] },
            conversation: { recentTurns: [] },
            retrieval: { evidence: [] },
            writing: null,
            budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] },
            frozenAt: Date.now(),
          },
          outputTarget: { type: 'chat-message' },
        },
      });
    });

    const state = latestHook!.operations.get('op-1');
    expect(state?.chatText).toBe('prefetched text');
    expect(state?.status).toBe('completed');
    expect(state?.events).toHaveLength(2);
  });

  it('updates tracked operation state for later streamed events', async () => {
    executeMock.mockResolvedValue({ operationId: 'op-2', sessionId: 'sess-2' });

    await act(async () => {
      await latestHook!.execute({
        operation: {
          id: 'op-2',
          sessionId: 'sess-2',
          surface: 'chat',
          intent: 'ask',
          prompt: 'hello later',
          context: {
            activeView: 'library',
            workspaceId: 'ws',
            article: null,
            selection: null,
            focusEntities: { paperIds: [], conceptIds: [] },
            conversation: { recentTurns: [] },
            retrieval: { evidence: [] },
            writing: null,
            budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] },
            frozenAt: Date.now(),
          },
          outputTarget: { type: 'chat-message' },
        },
      });
    });

    act(() => {
      emitEvent({
        type: 'model.delta',
        operationId: 'op-2',
        channel: 'chat',
        text: 'late text',
        sequence: 1,
        emittedAt: Date.now(),
      });
      emitEvent({
        type: 'operation.completed',
        operationId: 'op-2',
        sequence: 2,
        emittedAt: Date.now(),
      });
    });

    const state = latestHook!.operations.get('op-2');
    expect(state?.chatText).toBe('late text');
    expect(state?.status).toBe('completed');
    expect(state?.events).toHaveLength(2);
  });

  it('treats clarification completions as clarification_required instead of completed', async () => {
    executeMock.mockResolvedValue({ operationId: 'op-clarify', sessionId: 'sess-clarify' });

    await act(async () => {
      await latestHook!.execute({
        operation: {
          id: 'op-clarify',
          sessionId: 'sess-clarify',
          surface: 'chat',
          intent: 'ask',
          prompt: 'ambiguous',
          context: {
            activeView: 'library',
            workspaceId: 'ws',
            article: null,
            selection: null,
            focusEntities: { paperIds: [], conceptIds: [] },
            conversation: { recentTurns: [] },
            retrieval: { evidence: [] },
            writing: null,
            budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] },
            frozenAt: Date.now(),
          },
          outputTarget: { type: 'chat-message' },
        },
      });
    });

    act(() => {
      emitEvent({
        type: 'operation.clarification_required',
        operationId: 'op-clarify',
        question: 'Which one?',
        options: [{ id: 'rewrite', label: 'Rewrite' }],
        sequence: 1,
        emittedAt: Date.now(),
      });
    });

    const state = latestHook!.operations.get('op-clarify');
    expect(state?.status).toBe('clarification_required');
  });
});