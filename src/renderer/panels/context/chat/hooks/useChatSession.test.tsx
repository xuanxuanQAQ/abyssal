import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { useChatStore } from '../../../../core/store/useChatStore';
import { useChatSession } from './useChatSession';

const getHistoryMock = vi.fn();
const saveMessageMock = vi.fn();
const deleteSessionMock = vi.fn();

vi.mock('../../../../core/ipc/bridge', () => ({
  getAPI: () => ({
    db: {
      chat: {
        getHistory: getHistoryMock,
        saveMessage: saveMessageMock,
        deleteSession: deleteSessionMock,
      },
    },
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

type HookValue = ReturnType<typeof useChatSession>;

let latestHook: HookValue | null = null;

function HookHarness() {
  latestHook = useChatSession();
  return null;
}

describe('useChatSession', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    useChatStore.getState().clearChatHistory();
    latestHook = null;
    getHistoryMock.mockReset();
    saveMessageMock.mockReset();
    deleteSessionMock.mockReset();
    getHistoryMock.mockImplementation(async (sessionKey: string) => {
      if (sessionKey === 'chat:persisted') {
        return [
          {
            id: 'assistant-1',
            contextSourceKey: 'chat:persisted',
            role: 'assistant',
            content: 'restored answer',
            timestamp: 2,
          },
          {
            id: 'user-1',
            contextSourceKey: 'chat:persisted',
            role: 'user',
            content: 'restored question',
            timestamp: 1,
          },
        ];
      }
      return [];
    });

    queryClient = new QueryClient();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <HookHarness />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    queryClient.clear();
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('loads persisted messages when switching to an existing session', async () => {
    await act(async () => {
      latestHook!.switchSession('chat:persisted');
      await vi.waitFor(() => {
        expect(latestHook?.sessionKey).toBe('chat:persisted');
        expect(latestHook?.messages).toHaveLength(2);
      });
    });

    expect(getHistoryMock).toHaveBeenCalledWith('chat:persisted', { limit: 50 });
    expect(latestHook?.messages.map((message) => message.content)).toEqual([
      'restored answer',
      'restored question',
    ]);
  });
});