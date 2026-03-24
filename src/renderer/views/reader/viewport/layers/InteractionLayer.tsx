import React, { useRef, useState, useCallback } from 'react';
import { useReaderStore } from '../../../../core/store/useReaderStore';

export interface InteractionLayerProps {
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  onAreaSelect: (
    pageNumber: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Mouse event capture layer (z-index: 3).
 * Only active in areaHighlight mode.
 */
const InteractionLayer = React.memo(function InteractionLayer(props: InteractionLayerProps) {
  const { pageNumber, cssWidth, cssHeight, onAreaSelect } = props;

  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState<Point | null>(null);
  const [currentPos, setCurrentPos] = useState<Point | null>(null);

  const isActive = activeAnnotationTool === 'areaHighlight';

  const getRelativePosition = useCallback(
    (e: React.MouseEvent): Point => {
      const container = containerRef.current;
      if (!container) {
        return { x: 0, y: 0 };
      }
      const rect = container.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isActive || e.button !== 0) return;
      e.preventDefault();
      const pos = getRelativePosition(e);
      setStartPos(pos);
      setCurrentPos(pos);
      setIsDragging(true);
    },
    [isActive, getRelativePosition],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      setCurrentPos(getRelativePosition(e));
    },
    [isDragging, getRelativePosition],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !startPos || !currentPos) return;
      e.preventDefault();

      // Normalize rect so width/height are positive
      const x = Math.min(startPos.x, currentPos.x);
      const y = Math.min(startPos.y, currentPos.y);
      const width = Math.abs(currentPos.x - startPos.x);
      const height = Math.abs(currentPos.y - startPos.y);

      // Only emit if the selection has meaningful size
      if (width > 4 && height > 4) {
        onAreaSelect(pageNumber, { x, y, width, height });
      }

      setIsDragging(false);
      setStartPos(null);
      setCurrentPos(null);
    },
    [isDragging, startPos, currentPos, pageNumber, onAreaSelect],
  );

  // Compute selection rectangle for visual feedback
  let selectionRect: { left: number; top: number; width: number; height: number } | null = null;
  if (isDragging && startPos && currentPos) {
    selectionRect = {
      left: Math.min(startPos.x, currentPos.x),
      top: Math.min(startPos.y, currentPos.y),
      width: Math.abs(currentPos.x - startPos.x),
      height: Math.abs(currentPos.y - startPos.y),
    };
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: cssWidth,
        height: cssHeight,
        zIndex: 3,
        pointerEvents: isActive ? 'auto' : 'none',
        cursor: isActive ? 'crosshair' : undefined,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {selectionRect && (
        <div
          style={{
            position: 'absolute',
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
            border: '2px dashed var(--accent-color)',
            backgroundColor: 'rgba(var(--accent-color-rgb), 0.1)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
});

export { InteractionLayer };
