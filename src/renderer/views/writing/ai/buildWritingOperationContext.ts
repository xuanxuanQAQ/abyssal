/**
 * buildWritingOperationContext — 统一写作上下文构造器
 *
 * 无论 AI 操作从 ChatDock 还是快捷入口触发，
 * 都使用同一份上下文构造逻辑，保证上下文深度一致。
 *
 * 输出 ContextSnapshot，可直接注入 CopilotOperationEnvelope。
 */

import type {
  ContextSnapshot,
  EditorSelectionContext,
  WritingContextState,
} from '../../../../copilot-runtime/types';
import { useEditorStore } from '../../../core/store/useEditorStore';
import type { PersistedWritingTarget } from '../../../core/store/useEditorStore';
import type { JSONContent } from '@tiptap/core';
import { buildSectionContinuityContext } from '../../../../shared/writing/documentOutline';

export interface WritingContextParams {
  articleId: string;
  draftId: string | null;
  sectionId: string | null;
  documentJson: JSONContent | null;
  writingTarget: PersistedWritingTarget | null;
}

/**
 * 从 editor store + 传入参数构建深度写作上下文。
 * 包括 section continuity、selection context、unsavedChanges 等全部信息。
 */
// ── Section continuity cache ──
// Avoids re-parsing the full document JSON on every chat message.
// Invalidated when documentHash or sectionId changes.
let continuityCache: {
  documentHash: string | null;
  sectionId: string | null;
  result: ReturnType<typeof buildSectionContinuityContext>;
} | null = null;

export function buildWritingOperationContext(params: WritingContextParams): ContextSnapshot {
  const { articleId, draftId, sectionId, documentJson, writingTarget } = params;
  const editorState = useEditorStore.getState();
  const unsavedChanges = editorState.unsavedChanges;
  const documentHash = editorState.liveDocumentHash;

  // Section continuity（前节摘要、后续章节标题）— memoized by documentHash + sectionId
  let continuity: ReturnType<typeof buildSectionContinuityContext>;
  if (
    continuityCache &&
    continuityCache.documentHash === documentHash &&
    continuityCache.sectionId === sectionId
  ) {
    continuity = continuityCache.result;
  } else if (sectionId && documentJson) {
    continuity = buildSectionContinuityContext(documentJson, sectionId);
    continuityCache = { documentHash, sectionId, result: continuity };
  } else {
    continuity = { section: null, precedingSummary: '', followingSectionTitles: [] };
    continuityCache = null;
  }

  // Editor selection context — both range and caret targets produce a valid
  // EditorSelectionContext so that downstream intent routing and recipe
  // matching can recognise the writing surface.  Caret targets simply have
  // empty selectedText and from === to.
  const editorSelection: EditorSelectionContext | null =
    writingTarget
      ? {
          kind: 'editor',
          articleId,
          sectionId,
          selectedText: writingTarget.kind === 'range' ? writingTarget.selectedText : '',
          from: writingTarget.from,
          to: writingTarget.to,
          ...(writingTarget.anchorParagraphId ? { anchorParagraphId: writingTarget.anchorParagraphId } : {}),
          ...(writingTarget.beforeText ? { beforeText: writingTarget.beforeText } : {}),
          ...(writingTarget.afterText ? { afterText: writingTarget.afterText } : {}),
        }
      : null;

  // Writing state
  const writing: WritingContextState = {
    editorId: 'main',
    articleId,
    sectionId,
    unsavedChanges,
  };

  return {
    activeView: 'writing',
    workspaceId: '',
    article: {
      articleId,
      sectionId,
      ...(continuity.section?.title ? { sectionTitle: continuity.section.title } : {}),
      ...(continuity.precedingSummary ? { previousSectionSummaries: [continuity.precedingSummary] } : {}),
      ...(continuity.followingSectionTitles.length > 0 ? { nextSectionTitles: continuity.followingSectionTitles } : {}),
    },
    selection: editorSelection,
    focusEntities: { paperIds: [], conceptIds: [] },
    conversation: { recentTurns: [] },
    retrieval: { evidence: [] },
    writing,
    budget: {
      policy: 'deep',
      tokenBudget: 12000,
      includedLayers: ['surface', 'working', 'retrieval', 'history'],
    },
    frozenAt: Date.now(),
  };
}
