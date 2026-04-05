/**
 * useSelectionPreview — intercepts replace-range patches and provides
 * an accept/reject preview flow instead of blind auto-apply.
 *
 * Phase 2 (轻重操作分流): selection-level AI rewrites show an inline
 * preview before committing, keeping lightweight edits separate from
 * heavyweight route creation.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import type { EditorPatch, ReplaceRangePatch } from '../../../../copilot-runtime/types';
import { shouldHandleEditorPatch, applyEditorPatch } from './useEditorCommandBridge';

export interface SelectionPreviewState {
  /** The original text that would be replaced */
  originalText: string;
  /** The replacement content as plain text (extracted from JSONContent) */
  replacementText: string;
  /** The patch to apply if accepted */
  patch: ReplaceRangePatch;
}

interface UseSelectionPreviewOptions {
  editor: Editor | null;
  articleId: string;
}

function extractTextFromJson(json: Record<string, unknown>): string {
  if (typeof json.text === 'string') return json.text;
  const content = json.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return '';
  // Block-level nodes (paragraph, heading, etc.) are joined with newlines;
  // inline nodes (text with marks) are concatenated directly.
  const childTexts = content.map((node) => extractTextFromJson(node));
  // If children are block-level, join with newline; otherwise concat
  const hasBlockChildren = content.some(
    (node) => typeof node.type === 'string' && node.type !== 'text',
  );
  return childTexts.join(hasBlockChildren ? '\n' : '');
}

export function useSelectionPreview({ editor, articleId }: UseSelectionPreviewOptions) {
  const [preview, setPreview] = useState<SelectionPreviewState | null>(null);
  const pendingPatchRef = useRef<ReplaceRangePatch | null>(null);

  // Listen for replace-range patches and intercept them
  useEffect(() => {
    if (!editor) return;

    const handlePatch = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || detail.command !== 'apply-editor-patch') return;

      const patch = detail.patch as EditorPatch;
      if (!shouldHandleEditorPatch(articleId, patch)) return;

      // Only intercept replace-range patches (rewrite/expand/compress on selection)
      if (patch.kind !== 'replace-range') return;

      // Prevent default handling by useEditorCommandBridge
      event.stopImmediatePropagation();

      const originalText = editor.state.doc.textBetween(
        Math.min(patch.from, editor.state.doc.content.size),
        Math.min(patch.to, editor.state.doc.content.size),
        '\n',
      );
      const replacementText = extractTextFromJson(patch.content as Record<string, unknown>);

      pendingPatchRef.current = patch;
      setPreview({
        originalText,
        replacementText,
        patch,
      });
    };

    // Register BEFORE the bridge handler so stopImmediatePropagation works
    window.addEventListener('ai:applyEditorPatch', handlePatch);
    return () => window.removeEventListener('ai:applyEditorPatch', handlePatch);
  }, [articleId, editor]);

  const accept = useCallback(() => {
    if (!editor || !pendingPatchRef.current) return;
    applyEditorPatch(editor, pendingPatchRef.current);
    pendingPatchRef.current = null;
    setPreview(null);
  }, [editor]);

  const reject = useCallback(() => {
    pendingPatchRef.current = null;
    setPreview(null);
  }, []);

  return { preview, accept, reject };
}
