/**
 * useAIOperations — hook for Generate / Rewrite / Expand operations
 *
 * Each operation:
 * 1. Sets aiGenerating = true in useEditorStore
 * 2. Inserts an aiStreamingBlock node at the appropriate position
 * 3. Subscribes to pipeline.onStreamChunk via IPC
 * 4. Creates an AIStreamAccumulator to RAF-throttle chunk updates
 * 5. On isLast → performTerminalReplacement
 * 6. Sets aiGenerating = false
 */

import { useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { getAPI } from '../../../core/ipc/bridge';
import { AIStreamAccumulator } from './AIStreamAccumulator';
import { performTerminalReplacement } from './terminalReplacer';
import type { ParagraphMark } from './terminalReplacer';
import type { StreamChunkEvent } from '../../../../shared-types/ipc';

interface UseAIOperationsOptions {
  editor: Editor | null;
  sectionId: string | null;
}

interface AIOperationHandle {
  taskId: string;
  accumulator: AIStreamAccumulator;
  unsubscribe: () => void;
  /** For rewrite: the original selection range to delete on completion */
  originalRange: { from: number; to: number } | null;
}

export function useAIOperations({ editor, sectionId }: UseAIOperationsOptions) {
  const handleRef = useRef<AIOperationHandle | null>(null);

  /**
   * Insert an aiStreamingBlock at a given position and return its resolved pos.
   */
  const insertStreamingBlock = useCallback(
    (insertPos: number): number | null => {
      if (!editor) return null;

      const nodeType = editor.schema.nodes.aiStreamingBlock;
      if (!nodeType) return null;

      const blockNode = nodeType.create({ markdown: '', status: 'streaming' });
      editor
        .chain()
        .command(({ tr }) => {
          tr.insert(insertPos, blockNode);
          return true;
        })
        .run();

      return insertPos;
    },
    [editor],
  );

  /**
   * Shared streaming lifecycle: subscribe to chunks, accumulate, finalize.
   */
  const startStreaming = useCallback(
    (
      taskId: string,
      blockPos: number,
      markType: ParagraphMark,
      originalRange: { from: number; to: number } | null,
    ) => {
      if (!editor) return;

      const accumulator = new AIStreamAccumulator(editor, blockPos);

      const unsubscribe = getAPI().pipeline.onStreamChunk(
        (event: StreamChunkEvent) => {
          if (event.taskId !== taskId) return;

          // Re-locate the streaming block position in case prior transactions
          // shifted it, then update the accumulator so its RAF flush targets
          // the correct node.
          let currentBlockPos = blockPos;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'aiStreamingBlock') {
              currentBlockPos = pos;
              return false;
            }
            return true;
          });
          accumulator.updateBlockPos(currentBlockPos);

          accumulator.addChunk(event.chunk);

          if (event.isLast) {
            // Terminal replacement — use the up-to-date block position
            const success = performTerminalReplacement(editor, currentBlockPos, markType);

            if (success && originalRange) {
              // For rewrite: delete the original content that was replaced
              const { state } = editor;
              const { tr } = state;
              // After terminal replacement the positions may have shifted;
              // the original range was captured before insertion so we need
              // to account for the inserted content.  However the original
              // range is *above* the streaming block (which was inserted
              // after), so the positions are still valid.
              tr.delete(originalRange.from, originalRange.to);
              tr.setMeta('aiInsert', true);
              editor.view.dispatch(tr);
            }

            accumulator.destroy();
            unsubscribe();
            handleRef.current = null;
            useEditorStore.getState().setAIGenerating(false);
          }
        },
      );

      handleRef.current = { taskId, accumulator, unsubscribe, originalRange };
    },
    [editor],
  );

  // ── Generate: insert at end of document ──

  const generate = useCallback(async () => {
    if (!editor || !sectionId) return;
    if (useEditorStore.getState().aiGenerating) return;

    useEditorStore.getState().setAIGenerating(true);

    const endPos = editor.state.doc.content.size;
    const blockPos = insertStreamingBlock(endPos);
    if (blockPos === null) {
      useEditorStore.getState().setAIGenerating(false);
      return;
    }

    try {
      const taskId = await getAPI().pipeline.start('generate', {
        sectionId,
        operation: 'generate',
      });
      useEditorStore.getState().setAIGenerating(true, taskId);
      startStreaming(taskId, blockPos, 'AI-WRITTEN', null);
    } catch {
      useEditorStore.getState().setAIGenerating(false);
    }
  }, [editor, sectionId, insertStreamingBlock, startStreaming]);

  // ── Rewrite: insert after selection, delete original on completion ──

  const rewrite = useCallback(async () => {
    if (!editor || !sectionId) return;
    if (useEditorStore.getState().aiGenerating) return;

    const { from, to } = editor.state.selection;
    if (from === to) return; // Need a selection

    const selectedText = editor.state.doc.textBetween(from, to, '\n');
    useEditorStore.getState().setAIGenerating(true);

    const blockPos = insertStreamingBlock(to);
    if (blockPos === null) {
      useEditorStore.getState().setAIGenerating(false);
      return;
    }

    try {
      const taskId = await getAPI().pipeline.start('generate', {
        sectionId,
        operation: 'rewrite',
        selectedText,
      });
      useEditorStore.getState().setAIGenerating(true, taskId);
      startStreaming(taskId, blockPos, 'AI-WRITTEN', { from, to });
    } catch {
      useEditorStore.getState().setAIGenerating(false);
    }
  }, [editor, sectionId, insertStreamingBlock, startStreaming]);

  // ── Expand: insert after selection ──

  const expand = useCallback(async () => {
    if (!editor || !sectionId) return;
    if (useEditorStore.getState().aiGenerating) return;

    const { from, to } = editor.state.selection;
    const selectedText =
      from !== to
        ? editor.state.doc.textBetween(from, to, '\n')
        : '';

    const insertPos = to;
    useEditorStore.getState().setAIGenerating(true);

    const blockPos = insertStreamingBlock(insertPos);
    if (blockPos === null) {
      useEditorStore.getState().setAIGenerating(false);
      return;
    }

    try {
      const taskId = await getAPI().pipeline.start('generate', {
        sectionId,
        operation: 'expand',
        selectedText,
      });
      useEditorStore.getState().setAIGenerating(true, taskId);
      startStreaming(taskId, blockPos, 'AI-WRITTEN', null);
    } catch {
      useEditorStore.getState().setAIGenerating(false);
    }
  }, [editor, sectionId, insertStreamingBlock, startStreaming]);

  // ── Cancel: stop pipeline, mark block as completed ──

  const cancel = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;

    try {
      await getAPI().pipeline.cancel(handle.taskId);
    } catch {
      // Cancellation is best-effort
    }

    // Mark the streaming block as completed so the extension can render final state
    if (editor) {
      const { state } = editor;
      // Find the streaming block by traversing descendants and update its status
      let found = false;
      state.doc.descendants((descendant, pos) => {
        if (found) return false;
        if (descendant.type.name === 'aiStreamingBlock') {
          found = true;
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...descendant.attrs,
                status: 'completed',
              });
              return true;
            })
            .run();
          return false; // stop traversal
        }
        return true;
      });
    }

    handle.accumulator.destroy();
    handle.unsubscribe();
    handleRef.current = null;
    useEditorStore.getState().setAIGenerating(false);
  }, [editor]);

  return { generate, rewrite, expand, cancel };
}
