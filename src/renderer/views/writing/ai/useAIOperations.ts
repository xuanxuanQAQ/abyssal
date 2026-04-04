import { useCallback, useRef } from 'react';
import type { JSONContent } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import type {
  ContextSnapshot,
  CopilotIntent,
  CopilotOperationEnvelope,
  EditorSelectionContext,
  OutputTarget,
} from '../../../../copilot-runtime/types';
import { buildSectionContinuityContext } from '../../../../shared/writing/documentOutline';
import { useCopilotRuntime } from '../../../core/hooks/useCopilotRuntime';
import { useEditorStore } from '../../../core/store/useEditorStore';

interface UseAIOperationsOptions {
  editor: Editor | null;
  articleId: string | null;
  draftId: string | null;
  sectionId: string | null;
}

interface EditorSelectionSnapshot {
  from: number;
  to: number;
  selectedText: string;
}

function buildOperationPrompt(intent: CopilotIntent): string {
  switch (intent) {
    case 'generate-section':
      return '请继续完善当前章节，保持与上下文衔接，并优先吸收可用证据。';
    case 'rewrite-selection':
      return '请改写当前选中文本，在保留原意的前提下提升表达质量。';
    case 'expand-selection':
      return '请扩展当前选中文本，补足论证、细节或上下文。';
    case 'compress-selection':
      return '请压缩当前选中文本，保留关键信息并减少冗余。';
    default:
      return '请处理当前写作任务。';
  }
}

function buildSelectionOutputTarget(
  articleId: string,
  sectionId: string,
  selection: EditorSelectionSnapshot,
): OutputTarget {
  return {
    type: 'editor-selection-replace',
    editorId: 'main',
    articleId,
    sectionId,
    from: selection.from,
    to: selection.to,
  };
}

export function useAIOperations({ editor, articleId, draftId, sectionId }: UseAIOperationsOptions) {
  const { execute, abort } = useCopilotRuntime();
  const pendingOperationIdRef = useRef<string | null>(null);

  const buildOperationContext = useCallback((selection: EditorSelectionSnapshot | null): ContextSnapshot | null => {
    if (!editor || !articleId) return null;

    const documentJson = editor.getJSON() as JSONContent;
    const continuity = sectionId
      ? buildSectionContinuityContext(documentJson, sectionId)
      : { section: null, precedingSummary: '', followingSectionTitles: [] };

    const editorSelection: EditorSelectionContext | null = selection && sectionId
      ? {
          kind: 'editor',
          articleId,
          sectionId,
          selectedText: selection.selectedText,
          from: selection.from,
          to: selection.to,
        }
      : null;

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
      writing: {
        editorId: 'main',
        articleId,
        sectionId,
        unsavedChanges: useEditorStore.getState().unsavedChanges,
      },
      budget: {
        policy: 'deep',
        tokenBudget: 12000,
        includedLayers: ['surface', 'working', 'retrieval', 'history'],
      },
      frozenAt: Date.now(),
    };
  }, [articleId, editor, sectionId]);

  const startOperation = useCallback((
    intent: CopilotIntent,
    outputTarget: OutputTarget,
    selection: EditorSelectionSnapshot | null,
  ) => {
    if (!articleId) return;

    const context = buildOperationContext(selection);
    if (!context) return;

    const operationId = globalThis.crypto.randomUUID();
    const envelope: CopilotOperationEnvelope = {
      operation: {
        id: operationId,
        sessionId: `writing:${draftId ?? articleId}`,
        surface: 'editor-toolbar',
        intent,
        prompt: buildOperationPrompt(intent),
        context,
        outputTarget,
        constraints: {
          contextPolicy: 'deep',
          preserveSelection: selection !== null,
          preferExistingEvidence: true,
        },
      },
    };

    pendingOperationIdRef.current = operationId;
    useEditorStore.getState().setAIGenerating(true, operationId);

    void execute(envelope)
      .catch((error) => {
        console.error('Copilot writing operation failed:', error);
      })
      .finally(() => {
        if (pendingOperationIdRef.current !== operationId) return;
        pendingOperationIdRef.current = null;
        useEditorStore.getState().setAIGenerating(false);
      });
  }, [articleId, buildOperationContext, draftId, execute]);

  const captureSelection = useCallback((): EditorSelectionSnapshot | null => {
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    if (from === to) return null;

    return {
      from,
      to,
      selectedText: editor.state.doc.textBetween(from, to, '\n'),
    };
  }, [editor]);

  const generate = useCallback(() => {
    if (!editor || !articleId || !sectionId) return;
    if (useEditorStore.getState().aiGenerating) return;

    startOperation('generate-section', {
      type: 'section-replace',
      articleId,
      sectionId,
    }, null);
  }, [articleId, editor, sectionId, startOperation]);

  const rewrite = useCallback(() => {
    if (!editor || !articleId || !sectionId) return;
    if (useEditorStore.getState().aiGenerating) return;

    const selection = captureSelection();
    if (!selection) return;

    startOperation(
      'rewrite-selection',
      buildSelectionOutputTarget(articleId, sectionId, selection),
      selection,
    );
  }, [articleId, captureSelection, editor, sectionId, startOperation]);

  const expand = useCallback(() => {
    if (!editor || !articleId || !sectionId) return;
    if (useEditorStore.getState().aiGenerating) return;

    const selection = captureSelection();
    if (!selection) return;

    startOperation(
      'expand-selection',
      buildSelectionOutputTarget(articleId, sectionId, selection),
      selection,
    );
  }, [articleId, captureSelection, editor, sectionId, startOperation]);

  const compress = useCallback(() => {
    if (!editor || !articleId || !sectionId) return;
    if (useEditorStore.getState().aiGenerating) return;

    const selection = captureSelection();
    if (!selection) return;

    startOperation(
      'compress-selection',
      buildSelectionOutputTarget(articleId, sectionId, selection),
      selection,
    );
  }, [articleId, captureSelection, editor, sectionId, startOperation]);

  const cancel = useCallback(async () => {
    const operationId = pendingOperationIdRef.current ?? useEditorStore.getState().aiGeneratingTaskId;
    if (!operationId) return;

    pendingOperationIdRef.current = null;
    useEditorStore.getState().setAIGenerating(false);

    try {
      await abort(operationId);
    } catch (error) {
      console.error('Failed to abort copilot writing operation:', error);
    }
  }, [abort]);

  return { generate, rewrite, expand, compress, cancel };
}