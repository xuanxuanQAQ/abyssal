import React, { useRef, useCallback, useEffect } from 'react';
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
 * Mouse event capture layer (z-index: 4).
 * Only active in areaHighlight mode.
 */
const InteractionLayer = React.memo(function InteractionLayer(props: InteractionLayerProps) {
  const { pageNumber, cssWidth, cssHeight, onAreaSelect } = props;

  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const containerRef = useRef<HTMLDivElement>(null);

  const isDraggingRef = useRef(false);
  const startPosRef = useRef<Point | null>(null);
  const currentPosRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);
  const selectionDivRef = useRef<HTMLDivElement>(null);

  const isActive = activeAnnotationTool === 'areaHighlight';

  const getRelativePosition = useCallback(
    (e: React.MouseEvent | MouseEvent): Point => {
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

  const updateSelectionDiv = useCallback(() => {
    const div = selectionDivRef.current;
    const start = startPosRef.current;
    const current = currentPosRef.current;
    if (!div || !start || !current || !isDraggingRef.current) {
      if (div) div.style.display = 'none';
      return;
    }
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    div.style.display = '';
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isActive || e.button !== 0) return;
      e.preventDefault();
      const pos = getRelativePosition(e);
      startPosRef.current = pos;
      currentPosRef.current = pos;
      isDraggingRef.current = true;
      updateSelectionDiv();
    },
    [isActive, getRelativePosition, updateSelectionDiv],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      currentPosRef.current = getRelativePosition(e);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          updateSelectionDiv();
        });
      }
    },
    [getRelativePosition, updateSelectionDiv],
  );

  const finishDrag = useCallback(
    (e?: MouseEvent | React.MouseEvent) => {
      if (!isDraggingRef.current || !startPosRef.current || !currentPosRef.current) return;
      if (e) e.preventDefault();

      const start = startPosRef.current;
      const current = currentPosRef.current;
      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);

      if (width > 4 && height > 4) {
        onAreaSelect(pageNumber, { x, y, width, height });
      }

      isDraggingRef.current = false;
      startPosRef.current = null;
      currentPosRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      updateSelectionDiv();
    },
    [pageNumber, onAreaSelect, updateSelectionDiv],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => finishDrag(e),
    [finishDrag],
  );

  // Handle mouse-up outside the component (e.g., user drags out of bounds)
  useEffect(() => {
    const onWindowMouseUp = (e: MouseEvent) => {
      if (isDraggingRef.current) finishDrag(e);
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [finishDrag]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: cssWidth,
        height: cssHeight,
        zIndex: 4,
        pointerEvents: isActive ? 'auto' : 'none',
        cursor: isActive ? 'crosshair' : undefined,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
        ref={selectionDivRef}
        style={{
          position: 'absolute',
          display: 'none',
          border: '2px dashed var(--accent-color)',
          backgroundColor: 'rgba(var(--accent-color-rgb), 0.1)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

export { InteractionLayer };
