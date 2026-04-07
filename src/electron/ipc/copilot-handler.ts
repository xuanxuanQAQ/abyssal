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
  CopilotOperation,
  ContextSnapshot,
  ResumeOperationRequest,
} from '../../copilot-runtime/types';
import { ToolCallingGovernor } from '../../adapter/orchestrator/tool-calling-governor';
import { classifyPromptGate, type PromptGateType } from '../../adapter/orchestrator/prompt-injection-gating';
import { asArticleId } from '../../core/types/common';
import { buildChatSystemPrompt } from '../chat-system-prompt';
import type { SystemPromptBundle, SystemPromptInteractionMode } from '../../adapter/agent-loop/system-prompt-builder';
import { createEmbedFunction } from '../../adapter/llm-client/embed-function-factory';
import * as path from 'node:path';

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
// Tracks how much assistant text has been persisted (for incremental flush)
const lastPersistedLength = new Map<string, number>();

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

// Tracks in-flight hydration promises to prevent TOCTOU races
const hydrationInFlight = new Map<string, Promise<void>>();

async function hydrateConversationCache(
  ctx: AppContext,
  sessionId: string,
  currentPrompt?: string,
): Promise<void> {
  if (conversationCache.has(sessionId)) return;

  // If a hydration for this session is already in-flight, await it instead of starting a second one.
  const existing = hydrationInFlight.get(sessionId);
  if (existing) return existing;

  const promise = (async () => {
    try {
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
    } finally {
      hydrationInFlight.delete(sessionId);
    }
  })();

  hydrationInFlight.set(sessionId, promise);
  return promise;
}

export function clearCopilotSessionArtifacts(sessionId: string): void {
  conversationCache.delete(sessionId);
  hydrationInFlight.delete(sessionId);
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

/** Get or create the singleton CopilotRuntime. Exported for settings handler. */
export function getOrCreateCopilotRuntime(ctx: AppContext): CopilotRuntime {
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
      logger: (msg, data) => ctx.logger.info(`[CopilotRuntime] ${msg}`, data as Record<string, unknown>),
      buildSystemPrompt: async (operation) => {
        // Direct editor mutations use a focused writing prompt —
        // no tools, no project stats, just writing instructions.
        const EDITOR_MUTATION_INTENTS = new Set([
          'rewrite-selection', 'expand-selection', 'compress-selection', 'continue-writing',
        ]);
        if (EDITOR_MUTATION_INTENTS.has(operation.intent)) {
          return buildWritingSystemPrompt(operation, ctx);
        }

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

  // ── Intent embedding fallback ──
  // Create a dedicated EmbedFunction for semantic intent classification.
  // Cache is stored alongside other workspace metadata in .abyssal/cache/.
  const intentEmbedFn = createEmbedFunction({ configProvider: ctx.configProvider, logger: ctx.logger });
  if (intentEmbedFn.isAvailable) {
    deps.embedding = {
      embedFn: intentEmbedFn,
      cacheDir: path.join(ctx.workspaceRoot, '.abyssal', 'cache'),
    };
  }

  runtimeInstance = new CopilotRuntime(deps);

  // ── Auto-rebuild intent embeddings when embedding model/provider changes ──
  ctx.configProvider.onChange((event) => {
    if (!event.changedSections.includes('rag')) return;
    const prev = event.previous.rag;
    const curr = event.current.rag;
    if (prev.embeddingModel === curr.embeddingModel && prev.embeddingProvider === curr.embeddingProvider) return;

    ctx.logger.info('[CopilotRuntime] Embedding model changed — rebuilding intent embeddings', {
      from: `${prev.embeddingProvider}/${prev.embeddingModel}`,
      to: `${curr.embeddingProvider}/${curr.embeddingModel}`,
    });
    runtimeInstance?.rebuildIntentEmbeddings().catch((err) => {
      ctx.logger.warn('[CopilotRuntime] Intent embedding rebuild failed', { error: (err as Error).message });
    });
  });

  // Forward runtime events to push manager + build conversation cache
  runtimeInstance.onEvent(async (event) => {
    ctx.pushManager?.pushCopilotEvent(event);

    if (event.type === 'operation.started') {
      bindSessionToOperation(event.sessionId, event.operationId);
    }

    // Accumulate assistant text from model.delta events.
    // Incrementally persist to DB every ~2000 chars to survive crashes.
    if (event.type === 'model.delta' && event.channel === 'chat') {
      const prev = pendingAssistantText.get(event.operationId) ?? '';
      const updated = prev + event.text;
      pendingAssistantText.set(event.operationId, updated);

      if (updated.length - (lastPersistedLength.get(event.operationId) ?? 0) >= 2000) {
        const meta = operationMeta.get(event.operationId);
        if (meta) {
          lastPersistedLength.set(event.operationId, updated.length);
          try {
            await Promise.resolve(ctx.dbProxy.saveChatMessage({
              id: `${event.operationId}-assistant-wip`,
              contextSourceKey: meta.sessionId,
              role: 'assistant',
              content: updated,
              timestamp: Date.now(),
            }));
          } catch { /* best-effort incremental persist */ }
        }
      }
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

    // On operation completion, flush accumulated assistant text to conversation cache + DB
    if (event.type === 'operation.completed' || event.type === 'operation.failed') {
      const meta = operationMeta.get(event.operationId);
      const assistantText = pendingAssistantText.get(event.operationId) ?? '';
      const sessionId = resolveSessionIdForOperation(event.operationId);

      if (meta && assistantText) {
        pushTurn(meta.sessionId, 'assistant', assistantText);
        // Final persist — overwrites any WIP record with complete text
        try {
          await Promise.resolve(ctx.dbProxy.saveChatMessage({
            id: `${event.operationId}-assistant`,
            contextSourceKey: meta.sessionId,
            role: 'assistant',
            content: assistantText,
            timestamp: Date.now(),
          }));
        } catch { /* best-effort */ }

        // Clean up WIP record to avoid duplicate entries in chat history
        try {
          await Promise.resolve(ctx.dbProxy.deleteChatMessage(`${event.operationId}-assistant-wip`));
        } catch { /* best-effort cleanup */ }
      }

      // Cleanup
      pendingAssistantText.delete(event.operationId);
      lastPersistedLength.delete(event.operationId);
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
      lastPersistedLength.delete(event.operationId);
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
  lastPersistedLength.clear();
  operationMeta.clear();
  sessionToOperation.clear();
}

export function registerCopilotHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── copilot:execute ──
  // LLM calls can take well over 30s; use 120s and abort on timeout
  // to prevent ghost operations leaking tokens.
  const activeOperations = new Map<string, AbortController>();
  typedHandler('copilot:execute', logger, async (_e, envelope) => {
    const runtime = getOrCreateCopilotRuntime(ctx);
    const env = envelope as CopilotOperationEnvelope;
    const op = env.operation;
    const abortCtrl = new AbortController();
    activeOperations.set(op.id, abortCtrl);
    await hydrateConversationCache(ctx, op.sessionId ?? 'workspace', op.prompt);
    // Track user prompt for conversation cache
    if (op.prompt) {
      pushTurn(op.sessionId ?? 'workspace', 'user', op.prompt);
      operationMeta.set(op.id, { sessionId: op.sessionId ?? 'workspace', userPrompt: op.prompt });
    }
    try {
      const result = await runtime.execute(env);
      if (op.prompt) {
        syncOperationMeta(op.id, result.operationId, op.sessionId ?? 'workspace', op.prompt);
      }
      bindSessionToOperation(result.sessionId, result.operationId);
      return result;
    } finally {
      activeOperations.delete(op.id);
    }
  }, {
    timeoutMs: 120_000,
    onTimeout: () => {
      // Abort all active operations on timeout
      for (const [operationId, ctrl] of activeOperations) {
        logger.warn('Aborting timed-out copilot operation', { operationId });
        ctrl.abort();
        const runtime = getOrCreateCopilotRuntime(ctx);
        runtime.abort(operationId);
      }
      activeOperations.clear();
    },
  });

  // ── copilot:abort ──
  typedHandler('copilot:abort', logger, async (_e, operationId) => {
    const runtime = getOrCreateCopilotRuntime(ctx);
    runtime.abort(operationId as string);
  });

  // ── copilot:resume ──
  typedHandler('copilot:resume', logger, async (_e, request) => {
    const runtime = getOrCreateCopilotRuntime(ctx);
    const typedRequest = request as ResumeOperationRequest;
    const status = runtime.getOperationStatus(typedRequest.operationId);
    if (status) {
      bindSessionToOperation(status.sessionId, typedRequest.operationId);
    }
    return runtime.resume(typedRequest);
  });

  // ── copilot:getOperationStatus ──
  typedHandler('copilot:getOperationStatus', logger, async (_e, operationId) => {
    const runtime = getOrCreateCopilotRuntime(ctx);
    return runtime.getOperationStatus(operationId as string);
  });

  // ── copilot:listSessions ──
  typedHandler('copilot:listSessions', logger, async () => {
    const runtime = getOrCreateCopilotRuntime(ctx);
    return runtime.listSessions();
  });

  // ── copilot:getSession ──
  typedHandler('copilot:getSession', logger, async (_e, sessionId) => {
    const runtime = getOrCreateCopilotRuntime(ctx);
    return runtime.getSession(sessionId as string);
  });

  // ── copilot:clearSession ──
  typedHandler('copilot:clearSession', logger, async (_e, sessionId) => {
    const runtime = getOrCreateCopilotRuntime(ctx);
    clearCopilotSessionArtifacts(sessionId as string);
    sessionToOperation.delete(sessionId as string);
    runtime.clearSession(sessionId as string);
  });
}

// ─── Helpers ───

// ─── Writing-specific system prompt ───
// For direct editor mutations (rewrite/expand/compress/continue-writing),
// we use a focused prompt that constrains output to raw text only.
// Modelled after Cursor Apply / Claude Code apply behaviour.

const WRITING_INTENT_INSTRUCTIONS: Record<string, string> = {
  'rewrite-selection': [
    'The user wants you to REWRITE the selected text.',
    'The "Selected Editor Text" in the user message is the text to rewrite.',
    'The "Editor Context" (if present) shows surrounding text for style/tone reference.',
    'Produce an improved version preserving the original meaning. Match the style and language of the original.',
  ].join('\n'),
  'expand-selection': [
    'The user wants you to EXPAND the selected text.',
    'The "Selected Editor Text" in the user message is the text to expand.',
    'The "Editor Context" (if present) shows surrounding text for consistency.',
    'Elaborate on the ideas, adding detail, examples, or analysis.',
  ].join('\n'),
  'compress-selection': [
    'The user wants you to COMPRESS the selected text.',
    'The "Selected Editor Text" in the user message is the text to compress.',
    'Produce a shorter, more concise version while preserving the core meaning.',
  ].join('\n'),
  'continue-writing': [
    'The user wants you to CONTINUE WRITING from the current cursor position.',
    'The "Editor Context" section in the user message contains the text before and after the cursor.',
    'Seamlessly extend the text, maintaining style, tone, and argument flow.',
    'Write 1-3 paragraphs unless the user specifies otherwise.',
  ].join('\n'),
};

function buildWritingSystemPrompt(operation: CopilotOperation, ctx: AppContext): string {
  const lang = ctx.configProvider.config.language.defaultOutputLanguage;
  const langRule = lang ? `Always write in ${lang}.` : 'Write in the same language as the existing text.';
  const intentBlock = WRITING_INTENT_INSTRUCTIONS[operation.intent] ?? '';

  const lines: string[] = [];
  lines.push('You are a writing assistant integrated into the Abyssal academic workstation editor.');
  lines.push('');
  lines.push('## Task');
  lines.push(intentBlock);
  lines.push('');
  lines.push('## Output rules');
  lines.push(`- ${langRule}`);
  lines.push('- Output ONLY the resulting text. No greetings, explanations, meta-commentary, or markdown fences.');
  lines.push('- Do NOT describe what you are doing. Do NOT include phrases like "Here is the rewritten text".');
  lines.push('- Do NOT call any tools. This is a pure text generation task.');
  lines.push('- If the user added an instruction in their message, follow it while performing the task above.');
  return lines.join('\n');
}

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

const SYSTEM_PROMPT_BUNDLES = new Set<string>(['project_meta', 'active_focus', 'capability_hints']);
// Session-level bundles that are handled by other layers (e.g. buildPromptWithContext) —
// kept here so they don't trigger unknown-bundle warnings.
const SESSION_BUNDLES = new Set<string>(['selection_context', 'recent_activity', 'working_memory_light', 'working_memory_full']);

function toSystemPromptBundles(bundles: string[]): SystemPromptBundle[] {
  const result: SystemPromptBundle[] = [];
  for (const b of bundles) {
    if (SYSTEM_PROMPT_BUNDLES.has(b)) {
      result.push(b as SystemPromptBundle);
    } else if (!SESSION_BUNDLES.has(b)) {
      console.warn(`[copilot-handler] unknown prompt bundle dropped: ${b}`);
    }
  }
  return result;
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
