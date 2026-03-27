/**
 * EditedParagraphMarkers — visual indicators for researcher-edited paragraphs.
 *
 * Uses ProseMirror block-level node IDs (data-block-id) instead of array
 * indices to track edited paragraphs. This is immune to index shifting
 * when paragraphs are inserted/deleted above the edited one.
 *
 * Renders blue left-border bars + light-blue background overlay.
 *
 * See spec: section 4.5 (improved: ID-based instead of index-based)
 */

import React, { useEffect, useState } from 'react';

// ─── Props ───

interface EditedParagraphMarkersProps {
  /** The Tiptap editor's scrollable container element */
  editorContainer: HTMLElement | null;
  /**
   * Set of block IDs that have been manually edited.
   * These correspond to data-block-id attributes on ProseMirror block nodes.
   * Using IDs instead of indices prevents the index-shift bug where inserting
   * a paragraph above an edited one causes the wrong paragraph to be protected.
   */
  editedBlockIds: Set<string>;
}

// ─── Component ───

export function EditedParagraphMarkers({
  editorContainer,
  editedBlockIds,
}: EditedParagraphMarkersProps) {
  const [markerRects, setMarkerRects] = useState<Array<{ top: number; height: number; id: string }>>([]);

  useEffect(() => {
    if (!editorContainer || editedBlockIds.size === 0) {
      setMarkerRects([]);
      return;
    }

    const measure = () => {
      const proseMirror = editorContainer.querySelector('.ProseMirror');
      if (!proseMirror) return;

      const containerRect = editorContainer.getBoundingClientRect();
      const scrollTop = editorContainer.scrollTop;

      const rects: Array<{ top: number; height: number; id: string }> = [];

      // Find blocks by their data-block-id attribute (set by ProseMirror extension)
      for (const blockId of editedBlockIds) {
        const block = proseMirror.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
        if (!block) continue;

        const rect = block.getBoundingClientRect();
        rects.push({
          id: blockId,
          top: rect.top - containerRect.top + scrollTop,
          height: rect.height,
        });
      }

      setMarkerRects(rects);
    };

    measure();

    // Re-measure on scroll, resize, and content changes
    const observer = new ResizeObserver(measure);
    observer.observe(editorContainer);
    editorContainer.addEventListener('scroll', measure, { passive: true });

    // Also observe ProseMirror content changes via MutationObserver
    const proseMirror = editorContainer.querySelector('.ProseMirror');
    let mutationObserver: MutationObserver | undefined;
    if (proseMirror) {
      mutationObserver = new MutationObserver(measure);
      mutationObserver.observe(proseMirror, { childList: true, subtree: true, attributes: true });
    }

    return () => {
      observer.disconnect();
      editorContainer.removeEventListener('scroll', measure);
      mutationObserver?.disconnect();
    };
  }, [editorContainer, editedBlockIds]);

  if (markerRects.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {markerRects.map((rect) => (
        <div
          key={rect.id}
          style={{
            position: 'absolute',
            top: rect.top,
            left: 0,
            right: 0,
            height: rect.height,
            backgroundColor: 'rgba(59, 130, 246, 0.06)',
            borderLeft: '3px solid var(--accent-color, #3b82f6)',
            transition: 'top 150ms ease, height 150ms ease',
          }}
          title="Researcher-edited paragraph — protected during AI rewriting"
        />
      ))}
    </div>
  );
}

/**
 * Generate a unique block ID for a ProseMirror paragraph node.
 * Call this when a paragraph is first detected as edited.
 *
 * Usage in Tiptap onUpdate:
 *   const blockId = generateBlockId();
 *   editor.chain().setNodeAttribute('blockId', blockId).run();
 *   editedBlockIds.add(blockId);
 */
export function generateBlockId(): string {
  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
