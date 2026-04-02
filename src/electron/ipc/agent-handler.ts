/**
 * IPC handler: agent namespace
 *
 * Delegates to SessionOrchestrator for conversational AI interactions.
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
    const contextHint = chatCtx?.contextKey ?? 'global';
    // Unified conversation per workspace — contextHint is only used for prompt injection
    const conversationId = 'workspace';
    const scoped = scopedKey(ctx.workspaceRoot, conversationId);

    const orchestrator = ctx.sessionOrchestrator;

    logger.info('[chat:send] Routing', {
      contextHint,
      backend: orchestrator ? 'SessionOrchestrator' : 'none',
      msgLen: (message as string).length,
    });

    if (!orchestrator) {
      logger.warn('[chat:send] No AI backend available (no LLM configured)');
      ctx.pushManager?.pushAgentStream({
        type: 'error',
        conversationId,
        code: 'NO_LLM',
        message: 'No LLM configured. Add an API key in Settings → API Keys.',
      });
      return conversationId;
    }

    // Create AbortController for this conversation turn
    const abortController = new AbortController();
    activeAbortControllers.set(scoped, abortController);

    try {
      await orchestrator.handleUserMessage(message as string, chatCtx, abortController.signal);
    } catch (err) {
      if (abortController.signal.aborted) {
        // Aborted by user — push done event so frontend can finalize
        ctx.pushManager?.pushAgentStream({
          type: 'done',
          conversationId,
          fullText: '[Generation stopped by user]',
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      } else {
        const errorMessage = (err as Error).message ?? 'Unknown agent error';
        logger.warn('Agent loop error', { conversationId, error: errorMessage });
        ctx.pushManager?.pushAgentStream({
          type: 'error',
          conversationId,
          code: 'AGENT_ERROR',
          message: errorMessage,
        });
      }
    } finally {
      activeAbortControllers.delete(scoped);
    }

    return conversationId;
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

  typedHandler('db:chat:saveMessage', logger, async (_e, record) => {
    await ctx.dbProxy.saveChatMessage(record);
  });

  typedHandler('db:chat:getHistory', logger, async (_e, contextKey, opts?) => {
    // Read from SQLite — survives restart
    const records = await ctx.dbProxy.getChatHistory(contextKey, opts);
    // DB returns DESC order; reverse to chronological for frontend
    return records.reverse();
  });

  typedHandler('db:chat:deleteSession', logger, async (_e, contextKey) => {
    await ctx.dbProxy.deleteChatSession(contextKey);
    ctx.sessionOrchestrator?.clearConversation();
  });

  typedHandler('db:chat:listSessions', logger, async () => {
    return ctx.dbProxy.listChatSessions();
  });
}
