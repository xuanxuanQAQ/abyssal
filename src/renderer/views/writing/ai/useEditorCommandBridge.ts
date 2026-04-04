import { useEffect } from 'react';
import type { JSONContent } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import type { EditorPatch } from '../../../../copilot-runtime/types';
import { replaceSectionBodyInDocument } from '../../../../shared/writing/documentOutline';
import type { AICommandPayload } from '../../../../shared-types/ipc/contract';

interface UseEditorCommandBridgeOptions {
  editor: Editor | null;
  articleId: string;
  persistDocument: () => Promise<void> | void;
}

export function shouldHandleEditorPatch(articleId: string, patch: EditorPatch): boolean {
  const targetArticleId = patch.preconditions?.articleId;
  return typeof targetArticleId !== 'string' || targetArticleId.length === 0 || targetArticleId === articleId;
}

export function applyEditorPatch(editor: Editor, patch: EditorPatch): boolean {
  if (editor.isDestroyed) return false;

  switch (patch.kind) {
    case 'replace-range':
      return editor.chain().focus().insertContentAt({ from: patch.from, to: patch.to }, patch.content).run();

    case 'insert-at': {
      const pos = patch.pos < 0 ? editor.state.doc.content.size : patch.pos;
      return editor.chain().focus().insertContentAt(pos, patch.content).run();
    }

    case 'replace-section': {
      const nextDocument = replaceSectionBodyInDocument(
        editor.getJSON() as JSONContent,
        patch.sectionId,
        patch.content as JSONContent,
      );
      editor.commands.setContent(nextDocument, { emitUpdate: true });
      return true;
    }

    default:
      return false;
  }
}

export function useEditorCommandBridge({
  editor,
  articleId,
  persistDocument,
}: UseEditorCommandBridgeOptions): void {
  useEffect(() => {
    if (!editor) return;

    const handlePatch = (event: Event) => {
      const payload = (event as CustomEvent<AICommandPayload>).detail;
      if (!payload || payload.command !== 'apply-editor-patch') return;

      const patch = payload.patch as EditorPatch;
      if (!shouldHandleEditorPatch(articleId, patch)) return;

      applyEditorPatch(editor, patch);
    };

    const handlePersist = (event: Event) => {
      const payload = (event as CustomEvent<AICommandPayload>).detail;
      if (!payload || payload.command !== 'persist-document') return;
      if (payload.articleId !== articleId) return;
      void persistDocument();
    };

    window.addEventListener('ai:applyEditorPatch', handlePatch);
    window.addEventListener('ai:persistDocument', handlePersist);

    return () => {
      window.removeEventListener('ai:applyEditorPatch', handlePatch);
      window.removeEventListener('ai:persistDocument', handlePersist);
    };
  }, [articleId, editor, persistDocument]);
}