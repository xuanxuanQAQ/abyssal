/**
 * IPC handler: copilot namespace
 *
 * Routes copilot:execute, copilot:abort, copilot:resume, and session queries
 * to the CopilotRuntime.
 */

import type { AppContext } from '../app-context';
import type { ChatContext } from '../../shared-types/ipc';
import { typedHandler } from './register';
import { CopilotRuntime, type CopilotRuntimeDeps } from '../../copilot-runtime/runtime';
import type {
  CopilotOperationEnvelope,
  ContextSnapshot,
  ResumeOperationRequest,
} from '../../copilot-runtime/types';
import { ToolCallingGovernor } from '../../adapter/orchestrator/tool-calling-governor';
import { classifyPromptGate, type PromptGateType } from '../../adapter/orchestrator/prompt-injection-gating';
import { asArticleId } from '../../core/types/common';
import { buildChatSystemPrompt } from '../chat-system-prompt';
import type { SystemPromptBundle, SystemPromptInteractionMode } from '../../adapter/agent-loop/system-prompt-builder';

let runtimeInstance: CopilotRuntime | null = null;

// ─── In-memory conversation turn cache ───
// Keyed by sessionId → array of { role, text } turns.
// Fed by event listener on the runtime; consumed by getConversationTurns.
const MAX_TURNS_PER_SESSION = 40;
const conversationCache = new Map<string, Array<{ role: 'user' | 'assistant'; text: string }>>();
// Accumulates model.delta text per operationId for building assistant turns
const pendingAssistantText = new Map<string, string>();
// Maps operationId → { sessionId, userPrompt } for turn assembly
const operationMeta = new Map<string, { sessionId: string; userPrompt: string }>();
// Maps legacy conversation/session ids returned to the renderer → latest operation id
const sessionToOperation = new Map<string, string>();

function resolveSessionIdForOperation(operationId: string): string {
  const meta = operationMeta.get(operationId);
  if (meta) {
    return meta.sessionId;
  }

  for (const [sessionId, trackedOperationId] of sessionToOperation) {
    if (trackedOperationId === operationId) {
      return sessionId;
    }
  }

  return runtimeInstance?.getOperationStatus(operationId)?.sessionId ?? '';
}

function syncOperationMeta(
  requestedOperationId: string,
  actualOperationId: string,
  sessionId: string,
  userPrompt: string,
): void {
  operationMeta.set(requestedOperationId, { sessionId, userPrompt });
  operationMeta.set(actualOperationId, { sessionId, userPrompt });
}

function bindSessionToOperation(sessionId: string, operationId: string): void {
  sessionToOperation.set(sessionId, operationId);
}

async function hydrateConversationCache(
  ctx: AppContext,
  sessionId: string,
  currentPrompt?: string,
): Promise<void> {
  if (conversationCache.has(sessionId)) return;

  const records = await ctx.dbProxy.getChatHistory(sessionId, { limit: MAX_TURNS_PER_SESSION });
  const hydrated = records
    .slice()
    .reverse()
    .map((record) => ({ role: record.role, text: record.content }));

  if (
    currentPrompt &&
    hydrated.length > 0 &&
    hydrated[hydrated.length - 1]?.role === 'user' &&
    hydrated[hydrated.length - 1]?.text === currentPrompt
  ) {
    hydrated.pop();
  }

  conversationCache.set(sessionId, hydrated);
}

export function clearCopilotSessionArtifacts(sessionId: string): void {
  conversationCache.delete(sessionId);
  sessionToOperation.delete(sessionId);
  runtimeInstance?.clearSession(sessionId);

  for (const [operationId, meta] of operationMeta) {
    if (meta.sessionId === sessionId) {
      operationMeta.delete(operationId);
      pendingAssistantText.delete(operationId);
    }
  }
}

function pushTurn(sessionId: string, role: 'user' | 'assistant', text: string): void {
  if (!text.trim()) return;
  let turns = conversationCache.get(sessionId);
  if (!turns) {
    turns = [];
    conversationCache.set(sessionId, turns);
  }
  turns.push({ role, text });
  if (turns.length > MAX_TURNS_PER_SESSION) {
    conversationCache.set(sessionId, turns.slice(-MAX_TURNS_PER_SESSION));
  }
}

function getRuntime(ctx: AppContext): CopilotRuntime {
  if (runtimeInstance) return runtimeInstance;

  if (!ctx.llmClient) {
    throw new Error('No LLM configured. Add an API key in Settings → API Keys.');
  }

  const deps: CopilotRuntimeDeps = {
    context: {
      session: ctx.session!,
      workspaceId: ctx.workspaceRoot,
      getConversationTurns: (sessionId, limit) => {
        const turns = conversationCache.get(sessionId);
        if (!turns || turns.length === 0) return [];
        return turns.slice(-limit);
      },
      getArticleFocus: async (articleId, sectionId) => {
        try {
          const article = await ctx.dbProxy.getArticle(asArticleId(articleId));
          return article
            ? {
                articleId,
                sectionId: sectionId ?? null,
                ...(article.title ? { articleTitle: article.title } : {}),
              }
            : null;
        } catch {
          return null;
        }
      },
    },
    agent: {
      llmClient: ctx.llmClient,
      capabilities: ctx.capabilityRegistry ?? (() => { throw new Error('capabilityRegistry not initialized'); })(),
      session: ctx.session ?? (() => { throw new Error('session not initialized'); })(),
      eventBus: ctx.eventBus ?? (() => { throw new Error('eventBus not initialized'); })(),
      governor: new ToolCallingGovernor(),
      buildSystemPrompt: async (operation) => {
        const chatContext = snapshotToChatContext(operation.context);
        const gate = classifyPromptGate({
          userMessage: operation.prompt,
          chatContext,
          hasRecentSelection: operation.context.selection !== null,
        });
        return buildChatSystemPrompt(ctx, chatContext, {
          bundles: toSystemPromptBundles(gate.bundles),
          interactionMode: toInteractionMode(gate.type),
        });
      },
    },
    retrieval: {
      ragSearch: async (query, topK) => {
        if (!ctx.ragModule) return [];
        const results = await ctx.ragModule.searchSemantic(query, topK);
        return (results as Array<{ chunkId?: string; paperId?: string; text?: string; score?: number }>).map((r) => ({
          chunkId: r.chunkId ?? '',
          paperId: r.paperId ?? '',
          text: r.text ?? '',
          score: r.score ?? 0,
        }));
      },
    },
    editor: {
      reconcile: async (patch) => {
        // In Electron main process, reconciliation is delegated to renderer
        // For now, optimistic reconciliation — always pass
        return { ok: true };
      },
      applyPatch: async (patch) => {
        ctx.pushManager?.pushAiCommand({
          command: 'apply-editor-patch',
          patch,
        } as never);
      },
      persistDocument: async (articleId, sectionId) => {
        ctx.pushManager?.pushAiCommand({
          command: 'persist-document',
          articleId,
          sectionId,
        } as never);
      },
    },
    workflow: {
      startWorkflow: async (workflow, config) => {
        if (!ctx.orchestrator) throw new Error('Orchestrator not initialized');
        const state = ctx.orchestrator.start(workflow as never, config as never);
        return { taskId: (state as { id: string }).id };
      },
    },
    navigation: {
      navigate: async (view, entityId) => {
        ctx.pushManager?.pushAiCommand({
          command: 'navigate',
          view,
          ...(entityId ? { target: { paperId: entityId } } : {}),
        });
      },
    },
    logger: (msg, data) => ctx.logger.info(`[CopilotRuntime] ${msg}`, data as Record<string, unknown>),
  };

  runtimeInstance = new CopilotRuntime(deps);

  // Forward runtime events to push manager + build conversation cache
  runtimeInstance.onEvent((event) => {
    ctx.pushManager?.pushCopilotEvent(event);

    if (event.type === 'operation.started') {
      bindSessionToOperation(event.sessionId, event.operationId);
    }

    // Accumulate assistant text from model.delta events
    if (event.type === 'model.delta' && event.channel === 'chat') {
      const prev = pendingAssistantText.get(event.operationId) ?? '';
      pendingAssistantText.set(event.operationId, prev + event.text);
    }

    if (event.type === 'operation.clarification_required') {
      const meta = operationMeta.get(event.operationId);
      const assistantText = pendingAssistantText.get(event.operationId) ?? '';
      const sessionId = resolveSessionIdForOperation(event.operationId);

      if (meta && assistantText) {
        pushTurn(meta.sessionId, 'assistant', assistantText);
      }

      pendingAssistantText.delete(event.operationId);

      ctx.pushManager?.pushCopilotSessionChanged({
        sessionId,
        operationId: event.operationId,
      });
      return;
    }

    // On operation completion, flush accumulated assistant text to conversation cache
    if (event.type === 'operation.completed' || event.type === 'operation.failed') {
      const meta = operationMeta.get(event.operationId);
      const assistantText = pendingAssistantText.get(event.operationId) ?? '';
      const sessionId = resolveSessionIdForOperation(event.operationId);

      if (meta && assistantText) {
        pushTurn(meta.sessionId, 'assistant', assistantText);
      }

      // Cleanup
      pendingAssistantText.delete(event.operationId);
      operationMeta.delete(event.operationId);
      for (const [sessionId, operationId] of sessionToOperation) {
        if (operationId === event.operationId) {
          sessionToOperation.delete(sessionId);
        }
      }

      ctx.pushManager?.pushCopilotSessionChanged({
        sessionId,
        operationId: event.operationId,
      });
    }

    if (event.type === 'operation.aborted') {
      const sessionId = resolveSessionIdForOperation(event.operationId);
      pendingAssistantText.delete(event.operationId);
      operationMeta.delete(event.operationId);
      for (const [sessionId, operationId] of sessionToOperation) {
        if (operationId === event.operationId) {
          sessionToOperation.delete(sessionId);
        }
      }

      ctx.pushManager?.pushCopilotSessionChanged({
        sessionId,
        operationId: event.operationId,
      });
    }
  });

  return runtimeInstance;
}

/** Invalidate the runtime instance (called on config change / shutdown) */
export function invalidateCopilotRuntime(): void {
  runtimeInstance = null;
  conversationCache.clear();
  pendingAssistantText.clear();
  operationMeta.clear();
  sessionToOperation.clear();
}

export function registerCopilotHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── copilot:execute ──
  typedHandler('copilot:execute', logger, async (_e, envelope) => {
    const runtime = getRuntime(ctx);
    const env = envelope as CopilotOperationEnvelope;
    const op = env.operation;
    await hydrateConversationCache(ctx, op.sessionId ?? 'workspace', op.prompt);
    // Track user prompt for conversation cache
    if (op.prompt) {
      pushTurn(op.sessionId ?? 'workspace', 'user', op.prompt);
      operationMeta.set(op.id, { sessionId: op.sessionId ?? 'workspace', userPrompt: op.prompt });
    }
    const result = await runtime.execute(env);
    if (op.prompt) {
      syncOperationMeta(op.id, result.operationId, op.sessionId ?? 'workspace', op.prompt);
    }
    bindSessionToOperation(result.sessionId, result.operationId);
    return result;
  });

  // ── copilot:abort ──
  typedHandler('copilot:abort', logger, async (_e, operationId) => {
    const runtime = getRuntime(ctx);
    runtime.abort(operationId as string);
  });

  // ── copilot:resume ──
  typedHandler('copilot:resume', logger, async (_e, request) => {
    const runtime = getRuntime(ctx);
    const typedRequest = request as ResumeOperationRequest;
    const status = runtime.getOperationStatus(typedRequest.operationId);
    if (status) {
      bindSessionToOperation(status.sessionId, typedRequest.operationId);
    }
    return runtime.resume(typedRequest);
  });

  // ── copilot:getOperationStatus ──
  typedHandler('copilot:getOperationStatus', logger, async (_e, operationId) => {
    const runtime = getRuntime(ctx);
    return runtime.getOperationStatus(operationId as string);
  });

  // ── copilot:listSessions ──
  typedHandler('copilot:listSessions', logger, async () => {
    const runtime = getRuntime(ctx);
    return runtime.listSessions();
  });

  // ── copilot:getSession ──
  typedHandler('copilot:getSession', logger, async (_e, sessionId) => {
    const runtime = getRuntime(ctx);
    return runtime.getSession(sessionId as string);
  });

  // ── copilot:clearSession ──
  typedHandler('copilot:clearSession', logger, async (_e, sessionId) => {
    const runtime = getRuntime(ctx);
    clearCopilotSessionArtifacts(sessionId as string);
    sessionToOperation.delete(sessionId as string);
    runtime.clearSession(sessionId as string);
  });
}

// ─── Helpers ───

function snapshotToChatContext(snapshot: ContextSnapshot): ChatContext {
  const paperIds = snapshot.focusEntities.paperIds;
  return {
    activeView: snapshot.activeView,
    contextKey: `copilot-${snapshot.activeView}`,
    ...(paperIds.length > 0 ? { selectedPaperId: paperIds[0] } : {}),
    ...(paperIds.length > 1 ? { selectedPaperIds: paperIds } : {}),
    ...(snapshot.focusEntities.conceptIds.length > 0
      ? { selectedConceptId: snapshot.focusEntities.conceptIds[0] }
      : {}),
    ...(snapshot.selection?.kind === 'reader' && snapshot.selection.selectedText
      ? { selectedQuote: snapshot.selection.selectedText }
      : {}),
    ...(snapshot.selection?.kind === 'reader' && snapshot.selection.pdfPage != null
      ? { pdfPage: snapshot.selection.pdfPage }
      : {}),
  };
}

function toSystemPromptBundles(bundles: string[]): SystemPromptBundle[] {
  return bundles.filter((bundle): bundle is SystemPromptBundle => (
    bundle === 'project_meta' || bundle === 'active_focus' || bundle === 'capability_hints'
  ));
}

function toInteractionMode(type: PromptGateType): SystemPromptInteractionMode {
  switch (type) {
    case 'greeting':
    case 'smalltalk':
      return 'greeting';
    case 'assistant-profile':
      return 'assistant_profile';
    default:
      return 'default';
  }
}
