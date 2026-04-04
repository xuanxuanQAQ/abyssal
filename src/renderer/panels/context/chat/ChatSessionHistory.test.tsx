import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatSessionHistory } from './ChatSessionHistory';

const listSessionsMock = vi.fn();
const switchSessionMock = vi.fn();
const createNewSessionMock = vi.fn();

vi.mock('../../../core/ipc/bridge', () => ({
  getAPI: () => ({
    db: {
      chat: {
        listSessions: listSessionsMock,
        deleteSession: vi.fn(),
      },
    },
  }),
}));

vi.mock('./hooks/useChatSession', () => ({
  useChatSession: () => ({
    switchSession: switchSessionMock,
    sessionKey: 'workspace',
    createNewSession: createNewSessionMock,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'context.chat.messages' && params?.count != null) {
        return `${params.count} context.chat.messages`;
      }
      return key;
    },
  }),
}));

describe('ChatSessionHistory', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    listSessionsMock.mockReset();
    switchSessionMock.mockReset();
    createNewSessionMock.mockReset();
    queryClient = new QueryClient();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    queryClient.clear();
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('shows persisted workspace history instead of filtering it out', async () => {
    listSessionsMock.mockResolvedValue([
      {
        contextSourceKey: 'workspace',
        messageCount: 3,
        lastMessageAt: Date.now(),
      },
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatSessionHistory />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('3 context.chat.messages');
    expect(container.textContent).not.toContain('context.chat.noSessionHistory');
  });
});