import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

import { registerChatPersistenceHandlers } from './agent-handler';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('registerChatPersistenceHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
  });

  it('registers all db:chat channels and returns chronological history', async () => {
    const saveChatMessage = vi.fn(async () => undefined);
    const getChatHistory = vi.fn(async () => ([
      { id: 'm2', contextKey: 'paper:1' },
      { id: 'm1', contextKey: 'paper:1' },
    ]));
    const deleteChatSession = vi.fn(async () => undefined);
    const listChatSessions = vi.fn(async () => ([{ contextKey: 'paper:1', messageCount: 2 }]));
    const clearConversation = vi.fn();

    registerChatPersistenceHandlers({
      logger: makeLogger(),
      dbProxy: {
        saveChatMessage,
        getChatHistory,
        deleteChatSession,
        listChatSessions,
      },
      sessionOrchestrator: {
        clearConversation,
      },
    } as any);

    expect(registeredHandlers.has('db:chat:saveMessage')).toBe(true);
    expect(registeredHandlers.has('db:chat:getHistory')).toBe(true);
    expect(registeredHandlers.has('db:chat:deleteSession')).toBe(true);
    expect(registeredHandlers.has('db:chat:listSessions')).toBe(true);

    await registeredHandlers.get('db:chat:saveMessage')!({} as any, { id: 'm1' });
    expect(saveChatMessage).toHaveBeenCalledWith({ id: 'm1' });

    const history = await registeredHandlers.get('db:chat:getHistory')!({} as any, 'paper:1');
    expect(getChatHistory).toHaveBeenCalledWith('paper:1', undefined);
    expect(history).toEqual([
      { id: 'm1', contextKey: 'paper:1' },
      { id: 'm2', contextKey: 'paper:1' },
    ]);

    await registeredHandlers.get('db:chat:deleteSession')!({} as any, 'paper:1');
    expect(deleteChatSession).toHaveBeenCalledWith('paper:1');
    expect(clearConversation).toHaveBeenCalledWith('paper:1');

    const sessions = await registeredHandlers.get('db:chat:listSessions')!({} as any);
    expect(sessions).toEqual([{ contextKey: 'paper:1', messageCount: 2 }]);
  });
});