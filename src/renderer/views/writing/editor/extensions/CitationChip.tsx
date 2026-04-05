/**
 * CitationChip — ReactNodeView for CitationNode.
 *
 * Renders an inline chip/capsule showing the citation display text.
 * - Click → select node in ProseMirror
 * - Mod+Click → navigate to paper in Reader
 * - Hover 500ms → show CitationHoverCard
 */

import React, { useCallback, useState, useRef, useMemo } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { CitationHoverCard } from './CitationHoverCard';
import { useAppStore } from '../../../../core/store';
import { usePaper } from '../../../../core/ipc/hooks/usePapers';
import { buildCitationDisplayText } from './citationPaperMeta';

const chipStyle: React.CSSProperties = {
  display: 'inline',
  backgroundColor: 'color-mix(in srgb, var(--accent-color) 10%, transparent)',
  color: 'var(--accent-color)',
  borderRadius: '4px',
  padding: '1px 6px',
  fontSize: 'inherit',
  cursor: 'pointer',
  lineHeight: 'inherit',
  userSelect: 'none',
};

export function CitationChip({ node, editor, getPos }: NodeViewProps): React.ReactElement {
  const [showHover, setShowHover] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const paperId = (node.attrs.paperId as string) ?? '';
  const { data: paper } = usePaper(paperId);

  // Derive a richer display label from paper metadata when available
  const displayText = useMemo(() => buildCitationDisplayText(paper, paperId), [paper, paperId]);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const pos = getPos();
      if (pos == null || !editor.view) return;

      if (event.metaKey || event.ctrlKey) {
        navigateTo({ type: 'paper', id: paperId, view: 'reader' });
        return;
      }

      // Select the node in ProseMirror
      const { state } = editor.view;
      const tr = state.tr.setSelection(NodeSelection.create(state.doc, pos));
      editor.view.dispatch(tr);
      editor.view.focus();
    },
    [editor, getPos],
  );

  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      setShowHover(true);
    }, 500);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setShowHover(false);
  }, []);

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <CitationHoverCard paperId={paperId} open={showHover} onOpenChange={setShowHover}>
        <span
          style={chipStyle}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          role="button"
          tabIndex={-1}
          data-paper-id={paperId}
        >
          {displayText}
        </span>
      </CitationHoverCard>
    </NodeViewWrapper>
  );
}
