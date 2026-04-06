import { getAPI } from '../../../core/ipc/bridge';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { buildWritingOperationContext } from '../../../views/writing/ai/buildWritingOperationContext';
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
import type { JSONContent } from '@tiptap/core';

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
  const editorState = useEditorStore.getState();
  const writingTarget = editorState.persistedWritingTarget;
  const articleId = chatCtx?.selectedArticleId ?? null;

  // 写作视图下使用统一的深度上下文构造
  if (chatCtx?.activeView === 'writing' && articleId && writingTarget) {
    // Lazy-parse: only parse when document exists. buildWritingOperationContext
    // caches section continuity internally, so repeated messages skip the heavy work.
    const documentJson = editorState.liveDocumentJson
      ? JSON.parse(editorState.liveDocumentJson) as JSONContent
      : null;

    const snapshot = buildWritingOperationContext({
      articleId,
      draftId: chatCtx.selectedDraftId ?? null,
      sectionId: writingTarget.sectionId,
      documentJson,
      writingTarget,
    });

    // 合并 chat 特有的 focusEntities
    snapshot.focusEntities = {
      paperIds: getFocusedPaperIds(chatCtx),
      conceptIds: chatCtx.selectedConceptId ? [chatCtx.selectedConceptId] : [],
    };

    return snapshot;
  }

  // 非写作视图或无锚点时走标准路径
  const sectionId = chatCtx?.selectedSectionId ?? null;
  const unsavedChanges = editorState.unsavedChanges;

  // range 选区（有选中文本）或 caret 锚点（仅有位置）都应产出有效的
  // EditorSelectionContext，以便 IntentRouter 和 Recipe 识别写作表面。
  const hasEditorRange = Boolean(
    articleId &&
    chatCtx?.editorSelectionText,
  );
  const hasEditorCaret = Boolean(
    !hasEditorRange &&
    articleId &&
    chatCtx?.activeView === 'writing' &&
    chatCtx?.editorSelectionFrom != null,
  );



  const editorSelection = (hasEditorRange || hasEditorCaret)
    ? {
        kind: 'editor' as const,
        articleId: articleId as string,
        sectionId: sectionId ?? null,
        selectedText: chatCtx?.editorSelectionText ?? '',
        from: chatCtx?.editorSelectionFrom ?? 0,
        to: chatCtx?.editorSelectionTo ?? 0,
        ...(writingTarget?.anchorParagraphId ? { anchorParagraphId: writingTarget.anchorParagraphId } : {}),
        ...(writingTarget?.beforeText ? { beforeText: writingTarget.beforeText } : {}),
        ...(writingTarget?.afterText ? { afterText: writingTarget.afterText } : {}),
      }
    : null;

  return {
    activeView: chatCtx?.activeView ?? 'library',
    workspaceId: '',
    article: articleId
      ? {
          articleId,
          sectionId,
        }
      : null,
    selection: editorSelection
      ?? (chatCtx?.selectedQuote
        ? {
            kind: 'reader',
            paperId: chatCtx.selectedPaperId ?? '',
            selectedText: chatCtx.selectedQuote,
            ...(chatCtx.pdfPage != null ? { pdfPage: chatCtx.pdfPage } : {}),
            ...(chatCtx.imageClips ? { imageClips: chatCtx.imageClips } : {}),
          }
        : null),
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
    surface?: CopilotSurface | undefined;
    intent?: CopilotIntent | undefined;
    skipIdempotency?: boolean | undefined;
  },
): CopilotOperationEnvelope {
  const context = chatContextToSnapshot(chatCtx);
  const intent = options?.intent ?? 'ask';
  return {
    operation: {
      id: crypto.randomUUID(),
      sessionId,
      surface: options?.surface ?? 'chat',
      intent,
      prompt,
      context,
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
  context?: ChatContext | undefined;
  sessionId?: string | undefined;
  surface?: CopilotSurface | undefined;
  intent?: CopilotIntent | undefined;
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