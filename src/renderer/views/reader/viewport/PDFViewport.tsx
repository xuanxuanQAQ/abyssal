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
import type { ImageClip, SelectionPayload } from '../../../core/store/useReaderStore';
import { useAnnotations } from '../../../core/ipc/hooks/useAnnotations';
import { useRenderWindow } from '../hooks/useRenderWindow';
import { useZoom } from '../hooks/useZoom';
import { useAnnotationCRUD } from '../hooks/useAnnotationCRUD';
import { ToolbarStrip } from './ToolbarStrip';
import {
  ScrollContainer,
  type ScrollContainerHandle,
} from './ScrollContainer';
import { NotePopover } from '../annotations/NotePopover';
import { ConceptSelector } from '../annotations/ConceptSelector';
import { CreateConceptDialog } from '../../analysis/tabs/concepts/CreateConceptDialog';
import { MemoryBudget } from '../core/memoryBudget';
import type { PageMetadataMap } from '../core/pageMetadataPreloader';
import type { PDFDocumentManager } from '../core/pdfDocumentManager';
import type { Transform6 } from '../math/coordinateTransform';
import { computeInverseTransform } from '../math/inverseTransform';
import { useSelectionMachine } from '../selection/useSelectionMachine';
import { emitUserAction } from '../../../core/hooks/useEventBridge';
import { selectionToAnnotationPosition } from '../selection/selectionToAnnotation';
import type { AnnotationPosition, ContentBlockDTO } from '../../../../shared-types/models';
import { useConceptList as useConcepts } from '../../../core/ipc/hooks/useConcepts';
import type { Concept } from '../../../../shared-types/models';
import { useLayoutBlocks } from '../hooks/useLayoutBlocks';
import { useOcrLines } from '../hooks/useOcrLines';
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

function deriveConceptPrefillName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function selectionClipKey(
  pageNumber: number,
  type: string,
  bbox: { x: number; y: number; w: number; h: number },
): string {
  return [
    pageNumber,
    type,
    bbox.x.toFixed(4),
    bbox.y.toFixed(4),
    bbox.w.toFixed(4),
    bbox.h.toFixed(4),
  ].join(':');
}

function selectionClipFromBlock(block: ContentBlockDTO): string {
  return selectionClipKey(block.pageIndex + 1, block.type, block.bbox);
}

function selectionClipFromImage(clip: ImageClip): string {
  return selectionClipKey(clip.pageNumber, clip.type, clip.bbox);
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

  // OCR line-level bbox data for scanned pages
  const ocrLineMap = useOcrLines({
    paperId,
    totalPages,
  });

  const [selectedBlockClips, setSelectedBlockClips] = useState<Map<string, ImageClip>>(new Map());
  const [selectionSyncTick, setSelectionSyncTick] = useState(0);

  // Ensure payload/quotedSelection follows native Selection lifecycle,
  // including cases where useSelectionMachine state doesn't change.
  useEffect(() => {
    const onSelectionChange = () => {
      setSelectionSyncTick((tick) => tick + 1);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // Block select handler — toggle block capture clips into a local selection set.
  const handleBlockSelect = useCallback(
    (block: ContentBlockDTO) => {
      const clipKey = selectionClipFromBlock(block);
      setSelectedBlockClips((prev) => {
        if (prev.has(clipKey)) {
          const next = new Map(prev);
          next.delete(clipKey);
          return next;
        }

        // eslint-disable-next-line no-console
        console.log(`[DLA-Select] Block clicked: type=${block.type} page=${block.pageIndex} conf=${block.confidence.toFixed(2)}`);
        const container = containerRef.current;
        if (!container) return prev;

        const pageSlotEl = container.querySelector<HTMLElement>(
          `[data-page="${block.pageIndex + 1}"]`,
        );
        if (!pageSlotEl) return prev;

        const clip = captureBlockRegion(
          pageSlotEl,
          block.bbox,
          block.pageIndex + 1,
          block.type,
        );

        if (clip) {
          // eslint-disable-next-line no-console
          console.log(`[DLA-Select] Captured ${block.type} region (${clip.bbox.w.toFixed(3)}×${clip.bbox.h.toFixed(3)}) → dataUrl ${(clip.dataUrl.length / 1024).toFixed(1)}KB`);
        } else {
          console.warn('[DLA-Select] Canvas capture failed — canvas not available or region too small');
        }

        if (!clip) return prev;

        const next = new Map(prev);
        next.set(clipKey, clip);
        return next;
      });
    },
    [],
  );

  const getPageForSelection = useCallback(
    async (pageNumber: number) => {
      const doc = manager.getDocument();
      if (!doc) throw new Error('PDF document not loaded');
      return doc.getPage(pageNumber);
    },
    [manager],
  );

  // Text selection (unified state machine: mouse coords for DLA, Selection API for text)
  const textSelection = useSelectionMachine(blockMap, {
    getPage: getPageForSelection,
    scale: zoomLevel,
  });

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
    const manualImages = Array.from(selectedBlockClips.values());
    const liveSnapshot = buildDocumentSelectionSnapshot(window.getSelection());
    const debugEnabled = Boolean((window as any).__SELECTION_DEBUG__);

    const effectiveText =
      textSelection.selectedText
      ?? liveSnapshot?.selectedText
      ?? null;
    const effectivePrimaryPage =
      textSelection.primaryPageNumber
      ?? liveSnapshot?.segments[0]?.pageNumber
      ?? null;

    if (!effectiveText || !effectivePrimaryPage) {
      // Text selection dismissed: keep manually toggled image selection.
      if (debugEnabled) {
        // eslint-disable-next-line no-console
        console.log('[SelectionSync] clear text injection', {
          machineText: textSelection.selectedText,
          machinePage: textSelection.primaryPageNumber,
          liveText: liveSnapshot?.selectedText ?? null,
          livePage: liveSnapshot?.segments[0]?.pageNumber ?? null,
          manualImageCount: manualImages.length,
        });
      }
      useReaderStore.getState().setQuotedSelection(null);
      if (manualImages.length === 0) {
        useReaderStore.getState().setSelectionPayload(null);
        return;
      }

      const manualPages = Array.from(new Set(manualImages.map((clip) => clip.pageNumber))).sort((a, b) => a - b);
      useReaderStore.getState().setSelectionPayload({
        images: manualImages,
        sourcePages: manualPages,
      });
      return;
    }

    const mergedImages = new Map<string, ImageClip>();
    for (const clip of textSelection.payload?.images ?? []) {
      mergedImages.set(selectionClipFromImage(clip), clip);
    }
    for (const clip of manualImages) {
      mergedImages.set(selectionClipFromImage(clip), clip);
    }

    const mergedSourcePages = new Set<number>(textSelection.payload?.sourcePages ?? []);
    mergedSourcePages.add(effectivePrimaryPage);
    for (const clip of mergedImages.values()) {
      mergedSourcePages.add(clip.pageNumber);
    }

    const mergedPayload: SelectionPayload = {
      sourcePages: Array.from(mergedSourcePages).sort((a, b) => a - b),
    };

    const payloadText = textSelection.payload?.text ?? effectiveText;
    if (payloadText) {
      mergedPayload.text = payloadText;
    }

    const mergedImageList = Array.from(mergedImages.values());
    if (mergedImageList.length > 0) {
      mergedPayload.images = mergedImageList;
    }

    if (debugEnabled) {
      // eslint-disable-next-line no-console
      console.log('[SelectionSync] set merged payload', {
        text: payloadText,
        effectivePrimaryPage,
        machineText: textSelection.selectedText,
        machinePage: textSelection.primaryPageNumber,
        liveText: liveSnapshot?.selectedText ?? null,
        livePage: liveSnapshot?.segments[0]?.pageNumber ?? null,
        textPayloadImageCount: textSelection.payload?.images?.length ?? 0,
        manualImageCount: manualImages.length,
        mergedImageCount: mergedImageList.length,
        sourcePages: mergedPayload.sourcePages,
      });
    }

    useReaderStore.getState().setSelectionPayload(mergedPayload);

    useReaderStore.getState().setQuotedSelection({
      text: effectiveText,
      page: effectivePrimaryPage,
    });
  }, [
    textSelection.payload,
    textSelection.primaryPageNumber,
    textSelection.selectedText,
    selectedBlockClips,
    selectionSyncTick,
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
  const [pendingConceptCreation, setPendingConceptCreation] = useState<PendingStructuredSelection | null>(null);

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
      let frameId: number | null = null;
      let activeRenderTask: { cancel(): void; promise: Promise<void> } | null = null;

      const promise = (async () => {
        await new Promise<void>((resolve) => {
          frameId = window.requestAnimationFrame(() => {
            frameId = null;
            resolve();
          });
        });
        if (cancelled) return;

        const doc = manager.getDocument();
        if (!doc) return;

        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: renderScale });

        const context = canvas.getContext('2d');
        if (!context) return;

        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        // §5.4: Track render task for cancellation on document switch/destroy
        const renderTask = page.render({
          canvas,
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
          if (frameId != null) {
            window.cancelAnimationFrame(frameId);
            frameId = null;
          }
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

  // Whether text is selected and no annotation tool is active (for top toolbar actions)
  const hasTextSelection =
    textSelection.selectedText !== null && activeAnnotationTool === null;

  // Anchor position for NotePopover / ConceptSelector (set from toolbar button click)
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number } | null>(null);

  // Show NotePopover
  const showNotePopover = pendingNoteSelection != null;

  // Show ConceptSelector
  const showConceptSelector = pendingConceptSelection != null;

  const applyConceptSelection = useCallback((selection: PendingStructuredSelection, conceptId: string) => {
    if (selection.entries.length === 1) {
      const first = selection.entries[0]!;
      annotationCRUD.createConceptTag(
        first.page,
        first.position,
        first.selectedText,
        highlightColor,
        conceptId,
      );
      return;
    }

    annotationCRUD.createCrossPageAnnotations(
      selection.entries.map((entry) => ({
        ...entry,
        conceptId,
      })),
      'conceptTag',
      highlightColor,
    );
  }, [annotationCRUD, highlightColor]);

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
      <ToolbarStrip
        zoomActions={zoomActions}
        hasSelection={hasTextSelection}
        selectionHighlightColor={highlightColor}
        onSelectionHighlight={(color) => {
          if (!textSelection.selectedText) return;
          const entries = buildAnnotationEntries(textSelection.selectedText);
          if (entries.length === 0) return;
          if (entries.length === 1) {
            const first = entries[0]!;
            annotationCRUD.createHighlight(first.page, first.position, first.selectedText, color);
          } else {
            annotationCRUD.createCrossPageAnnotations(entries, 'highlight', color);
          }
          textSelection.clearSelection();
        }}
        onSelectionNote={(anchor) => {
          if (!textSelection.selectedText) return;
          const entries = buildAnnotationEntries(textSelection.selectedText);
          if (entries.length === 0) return;
          setPendingNoteSelection({ entries, selectedText: textSelection.selectedText });
          setPopoverAnchor(anchor);
          textSelection.clearSelection();
        }}
        onSelectionConceptTag={(anchor) => {
          if (!textSelection.selectedText) return;
          const entries = buildAnnotationEntries(textSelection.selectedText);
          if (entries.length === 0) return;
          setPendingConceptSelection({ entries, selectedText: textSelection.selectedText });
          setPopoverAnchor(anchor);
          textSelection.clearSelection();
        }}
        onColorChange={(color) => useReaderStore.getState().setHighlightColor(color)}
        capturedImageCount={textSelection.capturedImages?.length ?? 0}
      />

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
        ocrLineMap={ocrLineMap}
        onBlockSelect={handleBlockSelect}
        dragBoundsMap={textSelection.dragBoundsMap}
      />

      {showNotePopover && pendingNoteSelection && (
        <NotePopover
          open={showNotePopover}
          onOpenChange={(open) => {
            if (!open) {
              setPendingNoteSelection(null);
            }
          }}
          anchorRect={popoverAnchor}
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
          anchorRect={popoverAnchor}
          concepts={(conceptsData ?? []) as Concept[]}
          onSelect={(conceptId) => {
            applyConceptSelection(pendingConceptSelection, conceptId);
            setPendingConceptSelection(null);
          }}
          onCreateNew={() => {
            setPendingConceptCreation(pendingConceptSelection);
            setPendingConceptSelection(null);
          }}
        />
      )}

      {pendingConceptCreation && (
        <CreateConceptDialog
          open={pendingConceptCreation != null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingConceptCreation(null);
            }
          }}
          prefillNameEn={deriveConceptPrefillName(pendingConceptCreation.selectedText)}
          onCreated={(conceptId) => {
            applyConceptSelection(pendingConceptCreation, conceptId);
            setPendingConceptCreation(null);
          }}
        />
      )}
    </div>
  );
}

export { PDFViewport };
