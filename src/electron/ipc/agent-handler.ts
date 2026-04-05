/**
 * IPC handler: chat persistence
 *
 * Handles db:chat:* operations for saving/loading/deleting conversation history.
 *
 * Session keying: frontend sends `contextKey` (e.g. "paper:abc123"),
 * which scopes conversations per workspace + context entity.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { clearCopilotSessionArtifacts } from './copilot-handler';

export function registerChatPersistenceHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('db:chat:saveMessage', logger, async (_e, record) => {
    await ctx.dbProxy.saveChatMessage(record);
  });

  typedHandler('db:chat:getHistory', logger, async (_e, contextKey, opts?) => {
    const records = await ctx.dbProxy.getChatHistory(contextKey, opts);
    return records.reverse();
  });

  typedHandler('db:chat:deleteSession', logger, async (_e, contextKey) => {
    await ctx.dbProxy.deleteChatSession(contextKey);
    ctx.sessionOrchestrator?.clearConversation(contextKey);
    clearCopilotSessionArtifacts(contextKey);
  });

  typedHandler('db:chat:listSessions', logger, async () => {
    return ctx.dbProxy.listChatSessions();
  });
}
