import { getAPI } from '../../../core/ipc/bridge';
import { useEditorStore } from '../../../core/store/useEditorStore';
import type { ChatContext } from '../../../../shared-types/ipc';
import type {
  CopilotIntent,
  ContextSnapshot,
  CopilotOperationEnvelope,
  CopilotOperationEvent,
  CopilotSessionState,
  CopilotSurface,
  ToolCallEvent,
} from '../../../../copilot-runtime/types';

function getFocusedPaperIds(chatCtx?: ChatContext): string[] {
  const focused = chatCtx?.selectedPaperIds ?? [];
  if (!chatCtx?.selectedPaperId) {
    return focused;
  }

  return focused.includes(chatCtx.selectedPaperId)
    ? focused
    : [chatCtx.selectedPaperId, ...focused];
}

export function chatContextToSnapshot(chatCtx?: ChatContext): ContextSnapshot {
  const articleId = chatCtx?.selectedArticleId ?? null;
  const sectionId = chatCtx?.selectedSectionId ?? null;
  const unsavedChanges = useEditorStore.getState().unsavedChanges;
  const hasEditorSelection = Boolean(
    articleId &&
    sectionId &&
    chatCtx?.editorSelectionText,
  );

  return {
    activeView: chatCtx?.activeView ?? 'library',
    workspaceId: '',
    article: articleId
      ? {
          articleId,
          sectionId,
        }
      : null,
    selection: hasEditorSelection
      ? {
          kind: 'editor',
          articleId,
          sectionId: sectionId ?? '',
          selectedText: chatCtx?.editorSelectionText ?? '',
          from: chatCtx?.editorSelectionFrom ?? 0,
          to: chatCtx?.editorSelectionTo ?? 0,
        }
      : chatCtx?.selectedQuote
        ? {
            kind: 'reader',
            paperId: chatCtx.selectedPaperId ?? '',
            selectedText: chatCtx.selectedQuote,
            ...(chatCtx.pdfPage != null ? { pdfPage: chatCtx.pdfPage } : {}),
            ...(chatCtx.imageClips ? { imageClips: chatCtx.imageClips } : {}),
          }
        : null,
    focusEntities: {
      paperIds: getFocusedPaperIds(chatCtx),
      conceptIds: chatCtx?.selectedConceptId ? [chatCtx.selectedConceptId] : [],
    },
    conversation: { recentTurns: [] },
    retrieval: { evidence: [] },
    writing: articleId
      ? {
          editorId: 'main',
          articleId,
          sectionId,
          unsavedChanges,
        }
      : null,
    budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] },
    frozenAt: Date.now(),
  };
}

export function buildChatCopilotEnvelope(
  sessionId: string,
  prompt: string,
  chatCtx?: ChatContext,
  options?: {
    surface?: CopilotSurface;
    intent?: CopilotIntent;
    skipIdempotency?: boolean;
  },
): CopilotOperationEnvelope {
  return {
    operation: {
      id: crypto.randomUUID(),
      sessionId,
      surface: options?.surface ?? 'chat',
      intent: options?.intent ?? 'ask',
      prompt,
      context: chatContextToSnapshot(chatCtx),
      outputTarget: { type: 'chat-message' },
    },
    ...(options?.skipIdempotency ? { options: { skipIdempotency: true } } : {}),
  };
}

export function mapCopilotToolStatus(
  status: ToolCallEvent['status'],
): 'pending' | 'running' | 'completed' | 'error' {
  return status === 'failed' ? 'error' : status;
}

function collectOperationText(
  session: CopilotSessionState | null,
  operationId: string,
): string {
  if (!session) return '';

  return session.timeline
    .filter((event): event is Extract<CopilotOperationEvent, { type: 'model.delta' }> => (
      event.operationId === operationId &&
      event.type === 'model.delta' &&
      event.channel === 'chat'
    ))
    .map((event) => event.text)
    .join('');
}

export async function executeCopilotTextRequest(options: {
  prompt: string;
  context?: ChatContext;
  sessionId?: string;
  surface?: CopilotSurface;
  intent?: CopilotIntent;
}): Promise<string> {
  const api = getAPI();
  const sessionId = options.sessionId ?? `copilot:${crypto.randomUUID()}`;
  const envelope = buildChatCopilotEnvelope(sessionId, options.prompt, options.context, {
    surface: options.surface,
    intent: options.intent,
    skipIdempotency: true,
  });

  const result = await api.copilot.execute(envelope);
  const session = await api.copilot.getSession(result.sessionId) as CopilotSessionState | null;
  const failedEvent = session?.timeline.find((event) => (
    event.operationId === result.operationId && event.type === 'operation.failed'
  ));

  if (failedEvent && failedEvent.type === 'operation.failed') {
    throw new Error(failedEvent.message);
  }

  const aborted = session?.timeline.some((event) => (
    event.operationId === result.operationId && event.type === 'operation.aborted'
  ));
  if (aborted) {
    throw new Error('Operation aborted');
  }

  return collectOperationText(session, result.operationId);
}