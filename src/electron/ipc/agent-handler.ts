/**
 * IPC handler: agent namespace
 *
 * Delegates to AgentLoop for conversational AI interactions.
 * Responses stream via push:agent-stream channel.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

// In-memory conversation state (not persisted across restarts)
const conversations = new Map<string, {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId: string;
}>();

export function registerAgentHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('chat:send', logger, async (_e, message, context?) => {
    if (!ctx.agentLoop) {
      logger.warn('Agent Loop not available (no LLM configured)');
      return '';
    }

    const contextKey = (context as Record<string, unknown> | undefined)?.['contextKey'] as string | undefined;
    const conversationId = contextKey ?? crypto.randomUUID();

    let state = conversations.get(conversationId);
    if (!state) {
      state = { messages: [], conversationId };
      conversations.set(conversationId, state);
    }

    try {
      await ctx.agentLoop.run(message as string, state as any);
    } catch (err) {
      logger.warn('Agent loop error', { conversationId, error: (err as Error).message });
    }

    return conversationId;
  }, { timeoutMs: 120_000 });

  typedHandler('db:chat:saveMessage', logger, async (_e, record) => {
    const contextKey = record.contextSourceKey;
    let state = conversations.get(contextKey);
    if (!state) {
      state = { messages: [], conversationId: contextKey };
      conversations.set(contextKey, state);
    }
    state.messages.push({
      role: record.role,
      content: record.content,
    });
  });

  typedHandler('db:chat:getHistory', logger, async (_e, contextKey, _opts?) => {
    const state = conversations.get(contextKey);
    if (!state) return [];
    return state.messages.map((m, i) => ({
      id: `${contextKey}-${i}`,
      contextSourceKey: contextKey,
      role: m.role,
      content: m.content,
      timestamp: Date.now(),
    }));
  });

  typedHandler('db:chat:deleteSession', logger, async (_e, contextKey) => {
    conversations.delete(contextKey);
  });

  typedHandler('db:chat:listSessions', logger, async () => {
    return [...conversations.entries()].map(([id, state]) => ({
      contextSourceKey: id,
      messageCount: state.messages.length,
      lastMessageAt: Date.now(),
    }));
  });
}
