import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSessionHistory } from './ChatSessionHistory';

const listSessionsMock = vi.fn();
const deleteSessionMock = vi.fn();
const switchSessionMock = vi.fn();
const createNewSessionMock = vi.fn();

vi.mock('../../../core/ipc/bridge', () => ({
  getAPI: () => ({
    db: {
      chat: {
        listSessions: listSessionsMock,
        deleteSession: deleteSessionMock,
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
    deleteSessionMock.mockReset();
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

  it('confirms before deleting a session and then deletes it', async () => {
    listSessionsMock.mockResolvedValue([
      {
        contextSourceKey: 'workspace',
        messageCount: 3,
        lastMessageAt: Date.now(),
      },
    ]);
    deleteSessionMock.mockResolvedValue(undefined);

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

    const deleteButton = container.querySelector('button[title="common.delete"]') as HTMLButtonElement | null;
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.click();
    });

    const dialog = document.body.querySelector('[data-testid="app-dialog"]') as HTMLDivElement | null;
    expect(dialog?.textContent).toContain('context.chat.confirmDeleteSession');
    expect(deleteSessionMock).not.toHaveBeenCalled();

    const confirmButton = dialog?.querySelector('[data-dialog-action="confirm"]') as HTMLButtonElement | null;
    expect(confirmButton?.textContent).toBe('common.delete');

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(deleteSessionMock).toHaveBeenCalledWith('workspace');
    expect(createNewSessionMock).toHaveBeenCalled();
  });
});