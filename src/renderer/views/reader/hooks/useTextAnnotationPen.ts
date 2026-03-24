import { useEffect, useRef, useCallback, useState } from 'react';
import { useReaderStore } from '../../../core/store/useReaderStore';
import { useAnnotationCRUD } from './useAnnotationCRUD';
import { selectionToAnnotationPosition } from '../selection/selectionToAnnotation';
import type { CropBox } from '../math/normalizedCoords';
import type { Transform6 } from '../math/coordinateTransform';
import type { AnnotationPosition } from '../../../../shared-types/models';

interface PendingPosition {
  page: number;
  position: AnnotationPosition;
  selectedText: string;
}

export interface TextAnnotationPenState {
  pendingNotePosition: PendingPosition | null;
  pendingConceptPosition: PendingPosition | null;
  clearPending: () => void;
}

export function useTextAnnotationPen(
  paperId: string | null,
  getPageContext: (
    pageNumber: number,
  ) => { pageSlotRect: DOMRect; inverseTransform: Transform6; cropBox: CropBox } | null,
): TextAnnotationPenState {
  const [pendingNotePosition, setPendingNotePosition] =
    useState<PendingPosition | null>(null);
  const [pendingConceptPosition, setPendingConceptPosition] =
    useState<PendingPosition | null>(null);

  const { createHighlight } = useAnnotationCRUD(paperId);
  const getPageContextRef = useRef(getPageContext);
  getPageContextRef.current = getPageContext;

  const clearPending = useCallback((): void => {
    setPendingNotePosition(null);
    setPendingConceptPosition(null);
  }, []);

  useEffect(() => {
    const handleMouseUp = (): void => {
      const { activeAnnotationTool, highlightColor } =
        useReaderStore.getState();

      if (
        activeAnnotationTool !== 'textHighlight' &&
        activeAnnotationTool !== 'textNote' &&
        activeAnnotationTool !== 'textConceptTag'
      ) {
        return;
      }

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const { anchorNode } = sel;
      if (!anchorNode) return;

      // Verify selection is in a text layer
      let inTextLayer = false;
      let el: Element | null =
        anchorNode.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode.parentElement;

      while (el) {
        if (el.classList.contains('textLayer')) {
          inTextLayer = true;
          break;
        }
        el = el.parentElement;
      }

      if (!inTextLayer) return;

      // Find page number
      let pageNumber: number | null = null;
      el =
        anchorNode.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode.parentElement;

      while (el) {
        const pageAttr = el.getAttribute('data-page');
        if (pageAttr !== null) {
          const num = parseInt(pageAttr, 10);
          if (Number.isFinite(num)) {
            pageNumber = num;
            break;
          }
        }
        el = el.parentElement;
      }

      if (pageNumber === null) return;

      const ctx = getPageContextRef.current(pageNumber);
      if (!ctx) return;

      const range = sel.getRangeAt(0);
      const clientRects = range.getClientRects();
      const rects: DOMRect[] = [];
      for (let i = 0; i < clientRects.length; i++) {
        rects.push(clientRects[i]!);
      }

      if (rects.length === 0) return;

      const position = selectionToAnnotationPosition(
        rects,
        ctx.pageSlotRect,
        ctx.inverseTransform,
        ctx.cropBox,
      );

      const selectedText = sel.toString();

      if (activeAnnotationTool === 'textHighlight') {
        createHighlight(pageNumber, position, selectedText, highlightColor);
        sel.removeAllRanges();
      } else if (activeAnnotationTool === 'textNote') {
        createHighlight(pageNumber, position, selectedText, highlightColor);
        setPendingNotePosition({ page: pageNumber, position, selectedText });
        sel.removeAllRanges();
      } else if (activeAnnotationTool === 'textConceptTag') {
        createHighlight(pageNumber, position, selectedText, highlightColor);
        setPendingConceptPosition({
          page: pageNumber,
          position,
          selectedText,
        });
        sel.removeAllRanges();
      }
    };

    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [createHighlight]);

  return {
    pendingNotePosition,
    pendingConceptPosition,
    clearPending,
  };
}
