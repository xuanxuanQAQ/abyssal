/**
 * AIStreamAccumulator — RAF-throttled chunk accumulator for AI streaming
 *
 * Accumulates streaming text chunks and updates the aiStreamingBlock node's
 * `markdown` attribute at most once per animation frame to avoid layout thrash.
 *
 * Uses `editor.chain().command(...)` to issue a single ProseMirror transaction
 * that sets the node markup with the latest accumulated markdown.
 */

import type { Editor } from '@tiptap/react';

export class AIStreamAccumulator {
  private accumulated = '';
  private blockPos: number;
  private editor: Editor;
  private rafId: number | null = null;
  private pendingChunks: string[] = [];

  constructor(editor: Editor, blockPos: number) {
    this.editor = editor;
    this.blockPos = blockPos;
  }

  /**
   * Enqueue a chunk for the next RAF flush.
   */
  addChunk(chunk: string): void {
    this.pendingChunks.push(chunk);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  /**
   * Flush pending chunks into the accumulated string and update the
   * aiStreamingBlock node's `markdown` attribute in a single transaction.
   */
  private flush(): void {
    this.rafId = null;
    if (this.pendingChunks.length === 0) return;

    this.accumulated += this.pendingChunks.join('');
    this.pendingChunks = [];

    const { state } = this.editor;
    const node = state.doc.nodeAt(this.blockPos);
    if (node && node.type.name === 'aiStreamingBlock') {
      this.editor
        .chain()
        .command(({ tr }) => {
          tr.setNodeMarkup(this.blockPos, undefined, {
            ...node.attrs,
            markdown: this.accumulated,
          });
          return true;
        })
        .run();
    }
  }

  /**
   * Return the full accumulated text so far, including any pending chunks
   * that have not yet been flushed.
   */
  getAccumulated(): string {
    if (this.pendingChunks.length > 0) {
      this.accumulated += this.pendingChunks.join('');
      this.pendingChunks = [];
    }
    return this.accumulated;
  }

  /**
   * Update the block position after external transaction changes.
   * Call this when a mapping is required after other document mutations.
   */
  updateBlockPos(newPos: number): void {
    this.blockPos = newPos;
  }

  /**
   * Cancel any pending RAF and clean up.
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
