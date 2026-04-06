/**
 * useSelectionPreview — intercepts replace-range patches and provides
 * an accept/reject preview flow with streaming support.
 *
 * Two phases:
 *   1. Streaming: draftStreamText builds up in the editor store as LLM
 *      generates. The overlay shows live text with a pulsing indicator.
 *   2. Final: ai:applyEditorPatch fires with the complete patch.
 *      The overlay shows the diff with accept/reject buttons.
 *
 * For insert-at patches (continue-writing), the streaming phase shows
 * the text being appended, and the final phase offers accept/reject.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import type { EditorPatch, ReplaceRangePatch, InsertAtPatch } from '../../../../copilot-runtime/types';
import { shouldHandleEditorPatch, applyEditorPatch } from './useEditorCommandBridge';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { getAPI } from '../../../core/ipc/bridge';

export interface SelectionPreviewState {
  /** The original text that would be replaced (empty for insert-at) */
  originalText: string;
  /** The replacement / inserted content as plain text */
  replacementText: string;
  /** The patch to apply if accepted */
  patch: ReplaceRangePatch | InsertAtPatch;
  /** Whether the text is still streaming */
  streaming: boolean;
  /** Error message if the operation failed during streaming */
  error?: string;
}

interface UseSelectionPreviewOptions {
  editor: Editor | null;
  articleId: string;
}

function extractTextFromJson(json: Record<string, unknown>): string {
  if (typeof json.text === 'string') return json.text;
  const content = json.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return '';
  const childTexts = content.map((node) => extractTextFromJson(node));
  const hasBlockChildren = content.some(
    (node) => typeof node.type === 'string' && node.type !== 'text',
  );
  return childTexts.join(hasBlockChildren ? '\n' : '');
}

export function useSelectionPreview({ editor, articleId }: UseSelectionPreviewOptions) {
  const [preview, setPreview] = useState<SelectionPreviewState | null>(null);
  const pendingPatchRef = useRef<ReplaceRangePatch | InsertAtPatch | null>(null);
  const streamingOriginRef = useRef<{ originalText: string } | null>(null);

  // ── Phase 1: Streaming preview ──
  // When draftStreamText appears, show a streaming preview using the
  // persisted writing target to determine the original text range.
  const draftStreamText = useEditorStore((s) => s.draftStreamText);

  useEffect(() => {
    if (!editor || draftStreamText === null) return;
    // Only show streaming if we don't already have a final patch
    if (pendingPatchRef.current) return;

    // Capture original text on first stream chunk
    if (!streamingOriginRef.current) {
      const target = useEditorStore.getState().persistedWritingTarget;
      if (target && target.kind === 'range') {
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.min(target.from, docSize);
        const safeTo = Math.min(target.to, docSize);
        streamingOriginRef.current = {
          originalText: editor.state.doc.textBetween(safeFrom, safeTo, '\n'),
        };
      } else {
        // caret / continue-writing — no original text to replace
        streamingOriginRef.current = { originalText: '' };
      }
    }

    setPreview({
      originalText: streamingOriginRef.current.originalText,
      replacementText: draftStreamText,
      // Placeholder patch — will be replaced by real patch on completion
      patch: null as unknown as ReplaceRangePatch,
      streaming: true,
    });
  }, [draftStreamText, editor]);

  // ── Phase 2: Final patch arrives ──
  useEffect(() => {
    if (!editor) return;

    const handlePatch = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || detail.command !== 'apply-editor-patch') return;

      const patch = detail.patch as EditorPatch;
      if (!shouldHandleEditorPatch(articleId, patch)) return;

      // Intercept replace-range and insert-at patches
      if (patch.kind !== 'replace-range' && patch.kind !== 'insert-at') return;

      // Prevent default handling by useEditorCommandBridge
      event.stopImmediatePropagation();

      const replacementText = extractTextFromJson(patch.content as Record<string, unknown>);

      let originalText = '';
      if (patch.kind === 'replace-range') {
        originalText = editor.state.doc.textBetween(
          Math.min(patch.from, editor.state.doc.content.size),
          Math.min(patch.to, editor.state.doc.content.size),
          '\n',
        );
      }

      pendingPatchRef.current = patch;
      streamingOriginRef.current = null;
      setPreview({
        originalText,
        replacementText,
        patch,
        streaming: false,
      });
    };

    // Register BEFORE the bridge handler so stopImmediatePropagation works
    window.addEventListener('ai:applyEditorPatch', handlePatch);
    return () => window.removeEventListener('ai:applyEditorPatch', handlePatch);
  }, [articleId, editor]);

  // ── Error handling ──
  // Listen for draft errors so the preview can show them inline
  // instead of only in the chat area.
  useEffect(() => {
    const handleError = (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail?.message ?? '生成失败';
      setPreview((prev) => prev ? { ...prev, streaming: false, error: msg } : null);
    };
    window.addEventListener('ai:draftError', handleError);
    return () => window.removeEventListener('ai:draftError', handleError);
  }, []);

  const accept = useCallback(() => {
    if (!editor || !pendingPatchRef.current) return;
    applyEditorPatch(editor, pendingPatchRef.current);
    pendingPatchRef.current = null;
    streamingOriginRef.current = null;
    useEditorStore.getState().clearDraftStreamText();
    setPreview(null);
  }, [editor]);

  const reject = useCallback(() => {
    // If still streaming, abort the backend operation to stop wasting compute.
    const operationId = useEditorStore.getState().activeDraftOperationId;
    if (operationId) {
      void getAPI().copilot.abort(operationId);
    }
    pendingPatchRef.current = null;
    streamingOriginRef.current = null;
    useEditorStore.getState().clearDraftStreamText();
    setPreview(null);
  }, []);

  return { preview, accept, reject };
}
