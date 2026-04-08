/**
 * BlockOverlayLayer — DLA content block visualization (z-index: 3.5).
 *
 * Renders detected content blocks as colored overlays:
 * - figure: blue border
 * - table: green border
 * - formula: purple border
 * - caption types: gray dashed border
 * - text/title: not rendered (handled by TextLayer selection)
 *
 * Visible only when smartSelect tool is active.
 * Single-click on a block emits onBlockSelect.
 */

import React, { useCallback, useState } from 'react';
import type { ContentBlockDTO } from '../../../../../shared-types/models';
import { useReaderStore } from '../../../../core/store/useReaderStore';

/** Block type → visual style */
const BLOCK_STYLES: Record<string, { borderColor: string; label: string }> = {
  figure:          { borderColor: 'rgba(59, 130, 246, 0.7)',  label: 'Figure' },
  figure_caption:  { borderColor: 'rgba(156, 163, 175, 0.5)', label: 'Caption' },
  table:           { borderColor: 'rgba(16, 185, 129, 0.7)',  label: 'Table' },
  table_caption:   { borderColor: 'rgba(156, 163, 175, 0.5)', label: 'Caption' },
  table_footnote:  { borderColor: 'rgba(156, 163, 175, 0.4)', label: 'Footnote' },
  formula:         { borderColor: 'rgba(139, 92, 246, 0.7)',  label: 'Formula' },
  formula_caption: { borderColor: 'rgba(156, 163, 175, 0.5)', label: 'Caption' },
};

/** Content types that should be rendered as overlays */
const VISUAL_TYPES = new Set(Object.keys(BLOCK_STYLES));

export interface BlockOverlayLayerProps {
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  blocks: ContentBlockDTO[];
  onBlockSelect?: (block: ContentBlockDTO) => void;
  onBlockHover?: (block: ContentBlockDTO | null) => void;
}

const BlockOverlayLayer = React.memo(function BlockOverlayLayer(props: BlockOverlayLayerProps) {
  const { pageNumber: _pageNumber, cssWidth, cssHeight, blocks, onBlockSelect, onBlockHover } = props;

  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const isActive = activeAnnotationTool === 'smartSelect';
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const handleClick = useCallback(
    (block: ContentBlockDTO) => {
      if (!isActive) return;
      onBlockSelect?.(block);
    },
    [isActive, onBlockSelect],
  );

  const handleMouseEnter = useCallback(
    (idx: number, block: ContentBlockDTO) => {
      setHoveredIdx(idx);
      onBlockHover?.(block);
    },
    [onBlockHover],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIdx(null);
    onBlockHover?.(null);
  }, [onBlockHover]);

  // Filter to only visual block types
  const visualBlocks = blocks.filter((b) => VISUAL_TYPES.has(b.type));

  if (visualBlocks.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: cssWidth,
        height: cssHeight,
        zIndex: 3,
        pointerEvents: isActive ? 'auto' : 'none',
        opacity: isActive ? 1 : 0,
        transition: 'opacity 200ms ease',
      }}
    >
      {visualBlocks.map((block, idx) => {
        const style = BLOCK_STYLES[block.type];
        if (!style) return null;

        const isHovered = hoveredIdx === idx;
        const left = block.bbox.x * cssWidth;
        const top = block.bbox.y * cssHeight;
        const width = block.bbox.w * cssWidth;
        const height = block.bbox.h * cssHeight;
        const isCaption = block.type.includes('caption') || block.type === 'table_footnote';

        return (
          <div
            key={`${block.pageIndex}-${idx}`}
            onClick={() => handleClick(block)}
            onMouseEnter={() => handleMouseEnter(idx, block)}
            onMouseLeave={handleMouseLeave}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height,
              border: `2px ${isCaption ? 'dashed' : 'solid'} ${style.borderColor}`,
              backgroundColor: isHovered
                ? `${style.borderColor.replace(/[\d.]+\)$/, '0.08)')}`
                : 'transparent',
              borderRadius: 3,
              cursor: isActive ? 'pointer' : undefined,
              transition: 'background-color 150ms ease',
              boxSizing: 'border-box',
            }}
          >
            {/* Type label — shown on hover */}
            {isHovered && (
              <span
                style={{
                  position: 'absolute',
                  top: -20,
                  left: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#fff',
                  backgroundColor: style.borderColor.replace(/[\d.]+\)$/, '0.85)'),
                  padding: '1px 6px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  lineHeight: '16px',
                }}
              >
                {style.label}
                {block.confidence < 0.5 && ' ?'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

export { BlockOverlayLayer };
