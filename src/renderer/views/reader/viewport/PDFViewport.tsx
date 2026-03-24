/**
 * PDFViewport — 主视口容器（ToolbarStrip + ScrollContainer）
 *
 * 持有 ResizeObserver 驱动的容器尺寸、渲染窗口、
 * 标注工具状态、以及四层渲染的核心回调。
 */

import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  useMemo,
} from 'react';
import { useReaderStore } from '../../../core/store/useReaderStore';
import { useAnnotations } from '../../../core/ipc/hooks/useAnnotations';
import { useRenderWindow } from '../hooks/useRenderWindow';
import { useZoom } from '../hooks/useZoom';
import { useAnnotationCRUD } from '../hooks/useAnnotationCRUD';
import { useTextAnnotationPen } from '../hooks/useTextAnnotationPen';
import { ToolbarStrip } from './ToolbarStrip';
import {
  ScrollContainer,
  type ScrollContainerHandle,
} from './ScrollContainer';
import { SelectionToolbar } from '../annotations/SelectionToolbar';
import { NotePopover } from '../annotations/NotePopover';
import { ConceptSelector } from '../annotations/ConceptSelector';
import { MemoryBudget } from '../core/memoryBudget';
import type { PageMetadataMap } from '../core/pageMetadataPreloader';
import type { PDFDocumentManager } from '../core/pdfDocumentManager';
import type { Transform6 } from '../math/coordinateTransform';
import { computeInverseTransform } from '../math/inverseTransform';
import { useTextSelection } from '../selection/useTextSelection';
import { selectionToAnnotationPosition } from '../selection/selectionToAnnotation';
import type { AnnotationPosition } from '../../../../shared-types/models';
import type { HighlightColor } from '../../../../shared-types/enums';

export interface PDFViewportProps {
  paperId: string;
  manager: PDFDocumentManager;
  pageMetadataMap: PageMetadataMap;
}

function PDFViewport({ paperId, manager, pageMetadataMap }: PDFViewportProps) {
  const totalPages = useReaderStore((s) => s.totalPages);
  const zoomLevel = useReaderStore((s) => s.zoomLevel);
  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const highlightColor = useReaderStore((s) => s.highlightColor);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<ScrollContainerHandle>(null);
  const memoryBudgetRef = useRef(new MemoryBudget());

  // Container dimensions from ResizeObserver
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerWidth(width);
        setContainerHeight(height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // useZoom needs an HTMLDivElement ref — get it from ScrollContainer handle
  const scrollDivRef = useRef<HTMLDivElement | null>(null);
  const scrollDivRefForZoom = useMemo(
    () => ({
      get current() {
        return (
          scrollContainerRef.current?.getScrollContainer() ?? null
        );
      },
      set current(_v: HTMLDivElement | null) {
        // no-op: managed by ScrollContainer
      },
    }),
    [],
  ) as React.RefObject<HTMLDivElement | null>;

  // Zoom
  const zoomActions = useZoom(
    scrollDivRefForZoom,
    containerWidth,
    containerHeight,
    pageMetadataMap,
  );

  // Render window
  const renderWindow = useRenderWindow(totalPages, memoryBudgetRef.current);

  // Annotations
  const { data: annotations = [] } = useAnnotations(paperId);
  const annotationCRUD = useAnnotationCRUD(paperId);

  // Text selection
  const textSelection = useTextSelection();

  // Text annotation pen mode
  const getPageContext = useCallback(
    (pageNumber: number) => {
      const metadata = pageMetadataMap.get(pageNumber);
      if (!metadata) return null;

      const doc = manager.getDocument();
      if (!doc) return null;

      // We need the viewport transform for this page at current scale
      // Compute it from the metadata's cropBox dimensions
      const scale = zoomLevel;
      const transform: Transform6 = [scale, 0, 0, -scale, 0, metadata.baseHeight * scale];
      const inverseTransform = computeInverseTransform(transform);

      // PageSlotRect is unavailable here (we don't have access to DOM rects).
      // The useTextAnnotationPen hook should compute it differently.
      // Provide a placeholder DOMRect — actual implementation would query the DOM.
      const pageSlotRect = new DOMRect(0, 0, metadata.baseWidth * scale, metadata.baseHeight * scale);

      return {
        pageSlotRect,
        inverseTransform,
        cropBox: metadata.cropBox,
      };
    },
    [pageMetadataMap, manager, zoomLevel],
  );

  const textAnnotationPen = useTextAnnotationPen(paperId, getPageContext);

  // State for flashing and hovered annotations
  const [flashingAnnotationId, setFlashingAnnotationId] = useState<
    string | null
  >(null);

  // Pending note state (from SelectionToolbar)
  const [pendingNotePosition, setPendingNotePosition] = useState<{
    page: number;
    position: AnnotationPosition;
    selectedText: string;
  } | null>(null);

  // Pending concept tag state
  const [pendingConceptPosition, setPendingConceptPosition] = useState<{
    page: number;
    position: AnnotationPosition;
    selectedText: string;
  } | null>(null);

  // Render page callback
  const renderPage = useCallback(
    async (
      canvas: HTMLCanvasElement,
      pageNumber: number,
      renderScale: number,
      dpr: number,
    ) => {
      const doc = manager.getDocument();
      if (!doc) return;

      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: renderScale });

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const context = canvas.getContext('2d');
      if (!context) return;

      context.scale(dpr, dpr);

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;
    },
    [manager],
  );

  // Get page callback
  const getPage = useCallback(
    async (pageNumber: number) => {
      const doc = manager.getDocument();
      if (!doc) throw new Error('PDF document not loaded');
      return doc.getPage(pageNumber);
    },
    [manager],
  );

  // Get page transform callback
  const getPageTransform = useCallback(
    (pageNumber: number): Transform6 => {
      const metadata = pageMetadataMap.get(pageNumber);
      if (!metadata) return [1, 0, 0, 1, 0, 0];

      // Standard R=0 transform: x_dom = S * x_pdf, y_dom = S * (H - y_pdf)
      const scale = zoomLevel;
      return [scale, 0, 0, -scale, 0, metadata.baseHeight * scale];
    },
    [pageMetadataMap, zoomLevel],
  );

  // Area select handler
  const handleAreaSelect = useCallback(
    (
      pageNumber: number,
      rect: { x: number; y: number; width: number; height: number },
    ) => {
      const metadata = pageMetadataMap.get(pageNumber);
      if (!metadata) return;

      const position: AnnotationPosition = {
        rects: [rect],
        pageWidth: metadata.cropBox.maxX - metadata.cropBox.minX,
        pageHeight: metadata.cropBox.maxY - metadata.cropBox.minY,
        coordinateSystem: 'pdf_points',
      };

      annotationCRUD.createHighlight(pageNumber, position, '', highlightColor);
    },
    [annotationCRUD, pageMetadataMap, highlightColor],
  );

  // Annotation hover/click handlers
  const handleAnnotationHover = useCallback((_id: string | null) => {
    // Could set hovered state for visual feedback
  }, []);

  const handleAnnotationClick = useCallback((id: string) => {
    setFlashingAnnotationId(id);
    setTimeout(() => setFlashingAnnotationId(null), 1500);
  }, []);

  // Show SelectionToolbar when no annotation tool is active and text is selected
  const showSelectionToolbar =
    activeAnnotationTool === null && textSelection.selectedText !== null;

  // SelectionToolbar position from selection rects
  const selectionToolbarPosition = useMemo(() => {
    if (!textSelection.selectionRects || textSelection.selectionRects.length === 0) return null;
    const firstRect = textSelection.selectionRects[0]!;
    return { x: firstRect.left + firstRect.width / 2, y: firstRect.top - 8 };
  }, [textSelection.selectionRects]);

  // Show NotePopover
  const showNotePopover =
    textAnnotationPen.pendingNotePosition != null ||
    pendingNotePosition != null;
  const activeNotePosition =
    textAnnotationPen.pendingNotePosition ?? pendingNotePosition;

  // Show ConceptSelector
  const showConceptSelector = pendingConceptPosition != null;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <ToolbarStrip zoomActions={zoomActions} />

      <ScrollContainer
        ref={scrollContainerRef}
        totalPages={totalPages}
        scale={zoomLevel}
        pageMetadataMap={pageMetadataMap}
        renderWindow={renderWindow}
        annotations={annotations}
        flashingAnnotationId={flashingAnnotationId}
        getPageTransform={getPageTransform}
        renderPage={renderPage}
        getPage={getPage}
        onAreaSelect={handleAreaSelect}
        onAnnotationHover={handleAnnotationHover}
        onAnnotationClick={handleAnnotationClick}
      />

      {showSelectionToolbar && (
        <SelectionToolbar
          position={selectionToolbarPosition}
          highlightColor={highlightColor}
          onHighlight={(color) => {
            if (!textSelection.anchorPageNumber || !textSelection.selectionRects) return;
            const ctx = getPageContext(textSelection.anchorPageNumber);
            if (!ctx) return;
            const position = selectionToAnnotationPosition(
              textSelection.selectionRects,
              ctx.pageSlotRect,
              ctx.inverseTransform,
              ctx.cropBox,
            );
            annotationCRUD.createHighlight(
              textSelection.anchorPageNumber,
              position,
              textSelection.selectedText ?? '',
              color,
            );
            textSelection.clearSelection();
          }}
          onNote={() => {
            if (!textSelection.anchorPageNumber || !textSelection.selectionRects) return;
            const ctx = getPageContext(textSelection.anchorPageNumber);
            if (!ctx) return;
            const position = selectionToAnnotationPosition(
              textSelection.selectionRects,
              ctx.pageSlotRect,
              ctx.inverseTransform,
              ctx.cropBox,
            );
            setPendingNotePosition({
              page: textSelection.anchorPageNumber,
              position,
              selectedText: textSelection.selectedText ?? '',
            });
            textSelection.clearSelection();
          }}
          onConceptTag={() => {
            if (!textSelection.anchorPageNumber || !textSelection.selectionRects) return;
            const ctx = getPageContext(textSelection.anchorPageNumber);
            if (!ctx) return;
            const position = selectionToAnnotationPosition(
              textSelection.selectionRects,
              ctx.pageSlotRect,
              ctx.inverseTransform,
              ctx.cropBox,
            );
            setPendingConceptPosition({
              page: textSelection.anchorPageNumber,
              position,
              selectedText: textSelection.selectedText ?? '',
            });
            textSelection.clearSelection();
          }}
          onColorChange={(color) => {
            useReaderStore.getState().setHighlightColor(color);
          }}
        />
      )}

      {showNotePopover && activeNotePosition && (
        <NotePopover
          open={showNotePopover}
          onOpenChange={(open) => {
            if (!open) {
              textAnnotationPen.clearPending();
              setPendingNotePosition(null);
            }
          }}
          anchorRect={selectionToolbarPosition}
          initialText=""
          onSave={(noteText) => {
            annotationCRUD.createNote(
              activeNotePosition.page,
              activeNotePosition.position,
              activeNotePosition.selectedText,
              highlightColor,
              noteText,
            );
            textAnnotationPen.clearPending();
            setPendingNotePosition(null);
          }}
          onCancel={() => {
            textAnnotationPen.clearPending();
            setPendingNotePosition(null);
          }}
        />
      )}

      {showConceptSelector && pendingConceptPosition && (
        <ConceptSelector
          open={showConceptSelector}
          onOpenChange={(open) => {
            if (!open) setPendingConceptPosition(null);
          }}
          anchorRect={selectionToolbarPosition}
          concepts={[]} /* TODO: useConcepts() hook */
          onSelect={(conceptId) => {
            annotationCRUD.createConceptTag(
              pendingConceptPosition.page,
              pendingConceptPosition.position,
              pendingConceptPosition.selectedText,
              highlightColor,
              conceptId,
            );
            setPendingConceptPosition(null);
          }}
          onCreateNew={() => {
            // TODO: concept creation flow
            setPendingConceptPosition(null);
          }}
        />
      )}
    </div>
  );
}

export { PDFViewport };
