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
  const { articleId, draftId: _draftId, sectionId, documentJson, writingTarget } = params;
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
  //
  // beforeText/afterText from PersistedWritingTarget are only ~80 chars
  // (designed for anchor relocation). For AI operations (especially
  // continue-writing) we extract longer surrounding text from the full
  // document JSON so the LLM has enough context to write coherently.
  const { deepBefore, deepAfter } = documentJson
    ? extractDeepSurroundingText(documentJson, writingTarget?.from ?? 0, writingTarget?.to ?? 0)
    : { deepBefore: '', deepAfter: '' };

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
          beforeText: deepBefore || writingTarget.beforeText,
          afterText: deepAfter || writingTarget.afterText,
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

// ── Helpers ──

/** Max characters of surrounding text to extract for AI context. */
const DEEP_BEFORE_LIMIT = 2000;
const DEEP_AFTER_LIMIT = 500;

/**
 * Walk ProseMirror JSONContent to extract plain text, then slice around
 * the cursor position (from/to) to produce longer before/after context
 * than the 80-char PersistedWritingTarget anchor text.
 */
function extractDeepSurroundingText(
  doc: JSONContent,
  from: number,
  to: number,
): { deepBefore: string; deepAfter: string } {
  const fullText = jsonContentToPlainText(doc);
  // ProseMirror positions include structural offsets (node boundaries).
  // Plain text extraction drops those, so `from` may overshoot.
  // Clamp to actual text length; a rough position is still far better
  // than the 80-char fallback.
  const pos = Math.min(from, fullText.length);
  const endPos = Math.min(to, fullText.length);

  const deepBefore = fullText.slice(Math.max(0, pos - DEEP_BEFORE_LIMIT), pos);
  const deepAfter = fullText.slice(endPos, endPos + DEEP_AFTER_LIMIT);

  return { deepBefore, deepAfter };
}

/** Recursively extract plain text from ProseMirror JSONContent. */
function jsonContentToPlainText(node: JSONContent): string {
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }
  if (!node.content || !Array.isArray(node.content)) {
    // Block-level nodes without children (empty paragraphs, HRs, etc.)
    // still contribute a newline so paragraph breaks are preserved.
    const isBlock = node.type === 'paragraph' || node.type === 'heading'
      || node.type === 'blockquote' || node.type === 'horizontalRule'
      || node.type === 'bulletList' || node.type === 'orderedList'
      || node.type === 'listItem' || node.type === 'codeBlock';
    return isBlock ? '\n' : '';
  }
  const isBlockContainer = node.type === 'doc' || node.type === 'paragraph'
    || node.type === 'heading' || node.type === 'blockquote'
    || node.type === 'listItem';
  return node.content
    .map((child) => jsonContentToPlainText(child))
    .join(isBlockContainer ? '\n' : '');
}
