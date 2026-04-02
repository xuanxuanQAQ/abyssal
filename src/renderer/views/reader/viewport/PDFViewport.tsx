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
import { useSelectionMachine } from '../selection/useSelectionMachine';
import { emitUserAction } from '../../../core/hooks/useEventBridge';
import { selectionToAnnotationPosition } from '../selection/selectionToAnnotation';
import type { AnnotationPosition, ContentBlockDTO } from '../../../../shared-types/models';
import type { HighlightColor } from '../../../../shared-types/enums';
import { useConceptList as useConcepts } from '../../../core/ipc/hooks/useConcepts';
import type { Concept } from '../../../../shared-types/models';
import { useLayoutBlocks } from '../hooks/useLayoutBlocks';
import { captureBlockRegion } from './layers/captureBlockRegion';
import {
  buildDocumentSelectionSnapshot,
} from '../selection/documentSelection';

export interface PDFViewportProps {
  paperId: string;
  pdfPath: string | null;
  manager: PDFDocumentManager;
  pageMetadataMap: PageMetadataMap;
  scrollRef?: React.RefObject<ScrollContainerHandle | null>;
}

interface SelectionAnnotationEntry {
  page: number;
  position: AnnotationPosition;
  selectedText: string;
}

interface PendingStructuredSelection {
  entries: SelectionAnnotationEntry[];
  selectedText: string;
}

function PDFViewport({ paperId, pdfPath, manager, pageMetadataMap, scrollRef }: PDFViewportProps) {
  const totalPages = useReaderStore((s) => s.totalPages);
  const zoomLevel = useReaderStore((s) => s.zoomLevel);
  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const highlightColor = useReaderStore((s) => s.highlightColor);

  const containerRef = useRef<HTMLDivElement>(null);
  const internalScrollRef = useRef<ScrollContainerHandle>(null);
  const scrollContainerRef = scrollRef ?? internalScrollRef;
  const memoryBudgetRef = useRef(new MemoryBudget());

  // Container dimensions from ResizeObserver
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId = 0;
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const entry = entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          setContainerWidth(width);
          setContainerHeight(height);
        }
      });
    });

    observer.observe(container);
    return () => { cancelAnimationFrame(rafId); observer.disconnect(); };
  }, []);

  // useZoom needs an HTMLDivElement ref — get it from ScrollContainer handle
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

  // Ctrl+wheel zoom: attach handleWheelZoom to scroll container
  useEffect(() => {
    const container = scrollContainerRef.current?.getScrollContainer();
    if (!container) return;
    const handler = zoomActions.handleWheelZoom;
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  });

  // Render window
  const renderWindow = useRenderWindow(totalPages, memoryBudgetRef.current);

  // Annotations
  const { data: annotations = [] } = useAnnotations(paperId);
  const annotationCRUD = useAnnotationCRUD(paperId);

  // Concepts (for ConceptSelector and concept tag colors)
  const { data: conceptsData } = useConcepts();

  // DLA layout blocks
  const currentPage = useReaderStore((s) => s.currentPage);
  const blockMap = useLayoutBlocks({
    paperId,
    pdfPath,
    totalPages,
    currentPage,
  });

  // Block select handler — capture canvas region → write SelectionPayload to store
  const handleBlockSelect = useCallback(
    (block: ContentBlockDTO) => {
      console.log(`[DLA-Select] Block clicked: type=${block.type} page=${block.pageIndex} conf=${block.confidence.toFixed(2)}`);
      const container = containerRef.current;
      if (!container) return;

      const pageSlotEl = container.querySelector<HTMLElement>(
        `[data-page="${block.pageIndex + 1}"]`,
      );
      if (!pageSlotEl) return;

      const clip = captureBlockRegion(
        pageSlotEl,
        block.bbox,
        block.pageIndex + 1,
        block.type,
      );

      if (clip) {
        console.log(`[DLA-Select] Captured ${block.type} region (${clip.bbox.w.toFixed(3)}×${clip.bbox.h.toFixed(3)}) → dataUrl ${(clip.dataUrl.length / 1024).toFixed(1)}KB`);
      } else {
        console.warn('[DLA-Select] Canvas capture failed — canvas not available or region too small');
      }

      useReaderStore.getState().setSelectionPayload({
        images: clip ? [clip] : [],
        sourcePages: [block.pageIndex + 1],
      });
    },
    [],
  );

  // Text selection (unified state machine: mouse coords for DLA, Selection API for text)
  const textSelection = useSelectionMachine(blockMap);

  // Emit selectText event when user selects text
  useEffect(() => {
    if (textSelection.selectedText && textSelection.primaryPageNumber) {
      emitUserAction({
        action: 'selectText',
        paperId,
        text: textSelection.selectedText,
        page: textSelection.primaryPageNumber,
      });
    }
  }, [textSelection.selectedText, textSelection.primaryPageNumber, paperId]);

  // Auto-inject / clear current text selection into chat context.
  useEffect(() => {
    if (!textSelection.selectedText || !textSelection.primaryPageNumber) {
      // Selection dismissed → clear store
      useReaderStore.getState().setQuotedSelection(null);
      useReaderStore.getState().setSelectionPayload(null);
      return;
    }

    if (textSelection.payload) {
      useReaderStore.getState().setSelectionPayload(textSelection.payload);
    }

    useReaderStore.getState().setQuotedSelection({
      text: textSelection.selectedText,
      page: textSelection.primaryPageNumber,
    });
  }, [
    textSelection.payload,
    textSelection.primaryPageNumber,
    textSelection.selectedText,
  ]);

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

      // Query the actual page slot DOM element for its bounding rect.
      // Falls back to a computed rect if the element isn't mounted.
      const container = containerRef.current;
      const pageSlotEl = container?.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
      const pageSlotRect = pageSlotEl
        ? pageSlotEl.getBoundingClientRect()
        : new DOMRect(0, 0, metadata.baseWidth * scale, metadata.baseHeight * scale);

      return {
        pageSlotRect,
        inverseTransform,
        cropBox: metadata.cropBox,
      };
    },
    [pageMetadataMap, manager, zoomLevel],
  );

  const buildAnnotationEntries = useCallback(
    (
      selectedText: string,
    ): SelectionAnnotationEntry[] => {
      // Always re-read live Selection to get current viewport-relative rects.
      // Stored DOMRects in state go stale after scroll.
      const snapshot = buildDocumentSelectionSnapshot(window.getSelection());
      if (!snapshot) return [];

      const entries: SelectionAnnotationEntry[] = [];

      for (const segment of snapshot.segments) {
        if (segment.rects.length === 0) continue;
        const ctx = getPageContext(segment.pageNumber);
        if (!ctx) continue;

        const position = selectionToAnnotationPosition(
          segment.rects,
          ctx.pageSlotRect,
          ctx.inverseTransform,
          ctx.cropBox,
        );

        entries.push({
          page: segment.pageNumber,
          position,
          selectedText,
        });
      }

      return entries;
    },
    [getPageContext],
  );

  // State for flashing and hovered annotations
  const [flashingAnnotationId, setFlashingAnnotationId] = useState<
    string | null
  >(null);

  // Pending note state (supports cross-page selection)
  const [pendingNoteSelection, setPendingNoteSelection] = useState<PendingStructuredSelection | null>(null);

  // Pending concept tag state (supports cross-page selection)
  const [pendingConceptSelection, setPendingConceptSelection] = useState<PendingStructuredSelection | null>(null);

  // Render page callback — returns { promise, cancel } so callers can
  // abort the underlying pdfjs render task (critical for StrictMode double-invoke).
  const renderPage = useCallback(
    (
      canvas: HTMLCanvasElement,
      pageNumber: number,
      renderScale: number,
      dpr: number,
    ): { promise: Promise<void>; cancel: () => void } => {
      let cancelled = false;
      let activeRenderTask: { cancel(): void; promise: Promise<void> } | null = null;

      const promise = (async () => {
        const doc = manager.getDocument();
        if (!doc) return;

        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: renderScale });

        const context = canvas.getContext('2d');
        if (!context) return;

        context.scale(dpr, dpr);

        // §5.4: Track render task for cancellation on document switch/destroy
        const renderTask = page.render({
          canvasContext: context,
          viewport,
        });
        activeRenderTask = renderTask;
        manager.trackRenderTask(renderTask);
        try {
          await renderTask.promise;
        } finally {
          manager.untrackRenderTask(renderTask);
          activeRenderTask = null;
        }
      })();

      return {
        promise,
        cancel() {
          cancelled = true;
          if (activeRenderTask) {
            try { activeRenderTask.cancel(); } catch { /* already finished */ }
          }
        },
      };
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

  // Acrobat-style: when a text tool is active, auto-apply on mouseup
  const getPageContextRef = useRef(getPageContext);
  getPageContextRef.current = getPageContext;

  useEffect(() => {
    const handleMouseUp = () => {
      const tool = useReaderStore.getState().activeAnnotationTool;
      const color = useReaderStore.getState().highlightColor;
      if (tool !== 'textHighlight' && tool !== 'textNote' && tool !== 'textConceptTag') return;

      const snapshot = buildDocumentSelectionSnapshot(window.getSelection());
      if (!snapshot) return;

      const entries: SelectionAnnotationEntry[] = [];
      for (const segment of snapshot.segments) {
        if (segment.rects.length === 0) continue;
        const ctx = getPageContextRef.current(segment.pageNumber);
        if (!ctx) continue;

        const position = selectionToAnnotationPosition(
          segment.rects,
          ctx.pageSlotRect,
          ctx.inverseTransform,
          ctx.cropBox,
        );

        entries.push({
          page: segment.pageNumber,
          position,
          selectedText: snapshot.selectedText,
        });
      }
      if (entries.length === 0) return;

      if (tool === 'textHighlight') {
        if (entries.length === 1) {
          const first = entries[0]!;
          annotationCRUD.createHighlight(first.page, first.position, first.selectedText, color);
        } else {
          annotationCRUD.createCrossPageAnnotations(entries, 'highlight', color);
        }
      } else if (tool === 'textNote') {
        setPendingNoteSelection({
          entries,
          selectedText: snapshot.selectedText,
        });
      } else if (tool === 'textConceptTag') {
        setPendingConceptSelection({
          entries,
          selectedText: snapshot.selectedText,
        });
      }

      window.getSelection()?.removeAllRanges();
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [annotationCRUD]);

  // Acrobat-style: show SelectionToolbar when text is selected and NO tool is active
  // (when tool is active, mouseup auto-applies the action above)
  const showSelectionToolbar =
    textSelection.selectedText !== null && activeAnnotationTool === null;

  // SelectionToolbar position — reads live Selection rects so the toolbar
  // tracks the text even after the viewport scrolls.
  const [selectionToolbarPosition, setSelectionToolbarPosition] =
    useState<{ x: number; y: number } | null>(null);

  // Compute toolbar position from live browser Selection
  const updateToolbarPosition = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelectionToolbarPosition(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const firstRect = range.getClientRects()[0];
    if (!firstRect) {
      setSelectionToolbarPosition(null);
      return;
    }
    setSelectionToolbarPosition({
      x: firstRect.left + firstRect.width / 2,
      y: firstRect.top - 8,
    });
  }, []);

  // Update position when selection state changes
  useEffect(() => {
    if (showSelectionToolbar) {
      updateToolbarPosition();
    } else {
      setSelectionToolbarPosition(null);
    }
  }, [showSelectionToolbar, textSelection.selectedText, updateToolbarPosition]);

  // Update position on scroll so the toolbar follows the text
  useEffect(() => {
    if (!showSelectionToolbar) return;
    const container = scrollContainerRef.current?.getScrollContainer();
    if (!container) return;

    const handleScroll = () => {
      requestAnimationFrame(updateToolbarPosition);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [showSelectionToolbar, updateToolbarPosition]);

  // Show NotePopover
  const showNotePopover = pendingNoteSelection != null;

  // Show ConceptSelector
  const showConceptSelector = pendingConceptSelection != null;

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
        blockMap={blockMap}
        onBlockSelect={handleBlockSelect}
        dragBoundsMap={textSelection.dragBoundsMap}
      />

      {showSelectionToolbar && (
        <SelectionToolbar
          position={selectionToolbarPosition}
          highlightColor={highlightColor}
          onHighlight={(color) => {
            if (!textSelection.selectedText) return;
            const entries = buildAnnotationEntries(
              textSelection.selectedText,
            );
            if (entries.length === 0) return;

            if (entries.length === 1) {
              const first = entries[0]!;
              annotationCRUD.createHighlight(first.page, first.position, first.selectedText, color);
            } else {
              annotationCRUD.createCrossPageAnnotations(entries, 'highlight', color);
            }
            textSelection.clearSelection();
          }}
          onNote={() => {
            if (!textSelection.selectedText) return;
            const entries = buildAnnotationEntries(
              textSelection.selectedText,
            );
            if (entries.length === 0) return;

            setPendingNoteSelection({
              entries,
              selectedText: textSelection.selectedText,
            });
            textSelection.clearSelection();
          }}
          onConceptTag={() => {
            if (!textSelection.selectedText) return;
            const entries = buildAnnotationEntries(
              textSelection.selectedText,
            );
            if (entries.length === 0) return;

            setPendingConceptSelection({
              entries,
              selectedText: textSelection.selectedText,
            });
            textSelection.clearSelection();
          }}
          onColorChange={(color) => {
            useReaderStore.getState().setHighlightColor(color);
          }}
          capturedImageCount={textSelection.capturedImages?.length ?? 0}
        />
      )}

      {showNotePopover && pendingNoteSelection && (
        <NotePopover
          open={showNotePopover}
          onOpenChange={(open) => {
            if (!open) {
              setPendingNoteSelection(null);
            }
          }}
          anchorRect={selectionToolbarPosition}
          initialText=""
          onSave={(noteText) => {
            if (pendingNoteSelection.entries.length === 1) {
              const first = pendingNoteSelection.entries[0]!;
              annotationCRUD.createNote(
                first.page,
                first.position,
                first.selectedText,
                highlightColor,
                noteText,
              );
            } else {
              annotationCRUD.createCrossPageAnnotations(
                pendingNoteSelection.entries.map((entry) => ({
                  ...entry,
                  text: noteText,
                })),
                'note',
                highlightColor,
              );
            }
            setPendingNoteSelection(null);
          }}
          onCancel={() => {
            setPendingNoteSelection(null);
          }}
        />
      )}

      {showConceptSelector && pendingConceptSelection && (
        <ConceptSelector
          open={showConceptSelector}
          onOpenChange={(open) => {
            if (!open) setPendingConceptSelection(null);
          }}
          anchorRect={selectionToolbarPosition}
          concepts={(conceptsData ?? []) as Concept[]}
          onSelect={(conceptId) => {
            if (pendingConceptSelection.entries.length === 1) {
              const first = pendingConceptSelection.entries[0]!;
              annotationCRUD.createConceptTag(
                first.page,
                first.position,
                first.selectedText,
                highlightColor,
                conceptId,
              );
            } else {
              annotationCRUD.createCrossPageAnnotations(
                pendingConceptSelection.entries.map((entry) => ({
                  ...entry,
                  conceptId,
                })),
                'conceptTag',
                highlightColor,
              );
            }
            setPendingConceptSelection(null);
          }}
          onCreateNew={() => {
            // TODO: concept creation flow
            setPendingConceptSelection(null);
          }}
        />
      )}
    </div>
  );
}

export { PDFViewport };
