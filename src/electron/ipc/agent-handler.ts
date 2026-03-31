/**
 * IPC handler: agent namespace
 *
 * Delegates to AgentLoop for conversational AI interactions.
 * Responses stream via push:agentStream channel.
 *
 * Session keying: frontend sends `context.contextKey` (e.g. "paper:abc123"),
 * which is used to scope conversations per workspace + context entity.
 * The same key is used by db:chat:saveMessage / getHistory / deleteSession,
 * so frontend persistence and agent loop share the same conversation state.
 */

import type { AppContext } from '../app-context';
import type { ChatContext } from '../../shared-types/ipc';
import { typedHandler } from './register';

// ─── In-memory conversation state ───
// Keyed by `${workspaceRoot}::${contextKey}`.
// `messages` uses the Anthropic message format (string or ContentBlock[])
// so tool_use / tool_result history is preserved across turns.

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

const conversations = new Map<string, {
  messages: AgentMessage[];
  conversationId: string;
}>();

// Active AbortController per conversation (for cancellation support)
const activeAbortControllers = new Map<string, AbortController>();

/** Build a workspace-scoped key to isolate conversations per project */
function scopedKey(workspaceRoot: string, contextKey: string): string {
  return `${workspaceRoot}::${contextKey}`;
}

export function registerAgentHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('chat:send', logger, async (_e, message, context?) => {
    const chatCtx = context as ChatContext | undefined;
    const contextKey = chatCtx?.contextKey ?? 'global';
    const scoped = scopedKey(ctx.workspaceRoot, contextKey);

    // If no agent loop, push an error event so the frontend knows
    if (!ctx.agentLoop) {
      logger.warn('Agent Loop not available (no LLM configured)');
      ctx.pushManager?.pushAgentStream({
        type: 'error',
        conversationId: contextKey,
        code: 'NO_LLM',
        message: 'No LLM configured. Add an API key in Settings → API Keys.',
      });
      return contextKey;
    }

    let state = conversations.get(scoped);
    if (!state) {
      state = { messages: [], conversationId: contextKey };
      conversations.set(scoped, state);
    }

    // Create AbortController for this conversation turn
    const abortController = new AbortController();
    activeAbortControllers.set(scoped, abortController);

    try {
      await ctx.agentLoop.run(message as string, state as any, chatCtx, abortController.signal);
    } catch (err) {
      if (abortController.signal.aborted) {
        // Aborted by user — push done event so frontend can finalize
        ctx.pushManager?.pushAgentStream({
          type: 'done',
          conversationId: contextKey,
          fullText: '[Generation stopped by user]',
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      } else {
        const errorMessage = (err as Error).message ?? 'Unknown agent error';
        logger.warn('Agent loop error', { conversationId: contextKey, error: errorMessage });
        ctx.pushManager?.pushAgentStream({
          type: 'error',
          conversationId: contextKey,
          code: 'AGENT_ERROR',
          message: errorMessage,
        });
      }
    } finally {
      activeAbortControllers.delete(scoped);
    }

    return contextKey;
  }, { timeoutMs: 120_000 });

  typedHandler('chat:abort', logger, async (_e, conversationId?) => {
    // Abort all active conversations in this workspace, or a specific one
    if (conversationId) {
      const scoped = scopedKey(ctx.workspaceRoot, conversationId);
      const controller = activeAbortControllers.get(scoped);
      if (controller) {
        controller.abort();
        activeAbortControllers.delete(scoped);
      }
    } else {
      // Abort all active conversations for this workspace
      const prefix = ctx.workspaceRoot + '::';
      for (const [key, controller] of activeAbortControllers) {
        if (key.startsWith(prefix)) {
          controller.abort();
          activeAbortControllers.delete(key);
        }
      }
    }
  });

  // ─── Chat persistence ───
  // saveMessage writes to SQLite via DbProxy so history survives restart.
  // The in-memory `conversations` map is kept only for agent loop context
  // (which includes tool_use / tool_result blocks not stored in DB).

  typedHandler('db:chat:saveMessage', logger, async (_e, record) => {
    const contextKey = record.contextSourceKey;
    const scoped = scopedKey(ctx.workspaceRoot, contextKey);

    // Persist to SQLite
    await ctx.dbProxy.saveChatMessage(record);

    // Also maintain in-memory agent loop state
    const existing = conversations.get(scoped);
    if (existing) {
      existing.messages.push({ role: record.role, content: record.content });
    } else {
      conversations.set(scoped, {
        messages: [{ role: record.role, content: record.content }],
        conversationId: contextKey,
      });
    }
  });

  typedHandler('db:chat:getHistory', logger, async (_e, contextKey, opts?) => {
    // Read from SQLite — survives restart
    const records = await ctx.dbProxy.getChatHistory(contextKey, opts);
    // DB returns DESC order; reverse to chronological for frontend
    return records.reverse();
  });

  typedHandler('db:chat:deleteSession', logger, async (_e, contextKey) => {
    const scoped = scopedKey(ctx.workspaceRoot, contextKey);
    // Delete from both SQLite and in-memory cache
    await ctx.dbProxy.deleteChatSession(contextKey);
    conversations.delete(scoped);
  });

  typedHandler('db:chat:listSessions', logger, async () => {
    return ctx.dbProxy.listChatSessions();
  });
}
