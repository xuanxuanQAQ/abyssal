/**
 * 【Δ-1】aiStreamingBlock — atom block node for AI streaming content.
 *
 * Runtime-only node (never serialized to Markdown).
 * ReactNodeView handles all rendering via AiStreamingBlockView.
 *
 * Attrs:
 * - markdown: string (accumulated Markdown content)
 * - status: 'streaming' | 'completed' | 'error'
 */

import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { AiStreamingBlockView } from './AiStreamingBlockView';

export type AiStreamingStatus = 'streaming' | 'completed' | 'error';

export const aiStreamingBlockExtension = Node.create({
  name: 'aiStreamingBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      markdown: {
        default: '',
      },
      status: {
        default: 'streaming' as AiStreamingStatus,
      },
    };
  },

  // No parseDOM — runtime-only node, never serialized to Markdown
  parseHTML() {
    return [];
  },

  // No toDOM — ReactNodeView handles rendering
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'ai-streaming-block', 'data-status': HTMLAttributes.status }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AiStreamingBlockView);
  },

  /**
   * Extension storage for callbacks.
   * Host code should set these on the extension's storage to wire up
   * cancel/keep/discard functionality.
   */
  addStorage() {
    return {
      onCancel: null as ((pos: number) => void) | null,
      onKeep: null as ((pos: number) => void) | null,
      onDiscard: null as ((pos: number) => void) | null,
    };
  },
});
