import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { PageSlot } from './PageSlot';
import type { PageMetadataMap } from '../core/pageMetadataPreloader';
import type { RenderWindowResult } from '../core/renderWindow';
import type { Annotation, ContentBlockDTO, OcrLineDTO } from '../../../../shared-types/models';
import type { Transform6 } from '../math/coordinateTransform';
import type { ColumnBounds } from '../selection/dragEnvelope';
import { useCurrentPage } from '../hooks/useCurrentPage';
import { useReaderStore } from '../../../core/store/useReaderStore';

const PAGE_GAP = 8;

export interface ScrollContainerHandle {
  scrollToPage: (pageNumber: number) => void;
  getScrollContainer: () => HTMLDivElement | null;
}

export interface ScrollContainerProps {
  totalPages: number;
  scale: number;
  pageMetadataMap: PageMetadataMap;
  renderWindow: RenderWindowResult;
  annotations: Annotation[];
  flashingAnnotationId: string | null;
  getPageTransform: (pageNumber: number) => Transform6;
  renderPage: (
    canvas: HTMLCanvasElement,
    pageNumber: number,
    scale: number,
    dpr: number,
  ) => { promise: Promise<void>; cancel: () => void };
  getPage: (pageNumber: number) => Promise<any>;
  onAreaSelect: (
    pageNumber: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onAnnotationHover: (id: string | null) => void;
  onAnnotationClick: (id: string) => void;
  /** DLA block map: pageIndex (0-based) → blocks */
  blockMap?: Map<number, ContentBlockDTO[]>;
  /** OCR line map: pageIndex (0-based) → OCR lines for scanned pages */
  ocrLineMap?: Map<number, OcrLineDTO[]>;
  onBlockSelect?: (block: ContentBlockDTO) => void;
  /** Per-page DLA highlight bounds from DragEnvelope */
  dragBoundsMap?: Map<number, ColumnBounds[]>;
}

const ScrollContainer = forwardRef<ScrollContainerHandle, ScrollContainerProps>(
  function ScrollContainer(props, ref) {
    const {
      totalPages,
      scale,
      pageMetadataMap,
      renderWindow,
      annotations,
      flashingAnnotationId,
      getPageTransform,
      renderPage,
      getPage,
      onAreaSelect,
      onAnnotationHover,
      onAnnotationClick,
      blockMap,
      ocrLineMap,
      onBlockSelect,
      dragBoundsMap,
    } = props;

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
    const isHandTool = activeAnnotationTool === 'hand';

    // Hand tool: drag-to-scroll
    const isDraggingRef = useRef(false);
    const lastPosRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
      if (!isHandTool) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        isDraggingRef.current = true;
        lastPosRef.current = { x: e.clientX, y: e.clientY };
        container.style.cursor = 'grabbing';
        e.preventDefault();
      };
      const onMouseMove = (e: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - lastPosRef.current.x;
        const dy = e.clientY - lastPosRef.current.y;
        container.scrollLeft -= dx;
        container.scrollTop -= dy;
        lastPosRef.current = { x: e.clientX, y: e.clientY };
      };
      const onMouseUp = () => {
        isDraggingRef.current = false;
        container.style.cursor = 'grab';
      };

      container.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return () => {
        container.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        container.style.cursor = '';
      };
    }, [isHandTool]);

    // Track current page based on scroll position
    useCurrentPage(scrollContainerRef, totalPages);

    const scrollToPage = useCallback(
      (pageNumber: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let offset = 0;
        for (let i = 1; i < pageNumber; i++) {
          const meta = pageMetadataMap.get(i);
          if (meta) {
            offset += meta.baseHeight * scale + PAGE_GAP;
          }
        }

        container.scrollTop = offset;
      },
      [pageMetadataMap, scale],
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToPage,
        getScrollContainer: () => scrollContainerRef.current,
      }),
      [scrollToPage],
    );

    // Filter annotations per page
    const annotationsByPage = useMemo(() => {
      const map = new Map<number, Annotation[]>();
      for (const annotation of annotations) {
        const page = annotation.page;
        if (page == null) continue;
        const existing = map.get(page);
        if (existing) {
          existing.push(annotation);
        } else {
          map.set(page, [annotation]);
        }
      }
      return map;
    }, [annotations]);

    // Stabilize callback refs so PageSlot list doesn't rebuild on every parent render.
    const getPageTransformRef = useRef(getPageTransform);
    getPageTransformRef.current = getPageTransform;
    const renderPageRef = useRef(renderPage);
    renderPageRef.current = renderPage;
    const getPageRef = useRef(getPage);
    getPageRef.current = getPage;
    const onAreaSelectRef = useRef(onAreaSelect);
    onAreaSelectRef.current = onAreaSelect;
    const onAnnotationHoverRef = useRef(onAnnotationHover);
    onAnnotationHoverRef.current = onAnnotationHover;
    const onAnnotationClickRef = useRef(onAnnotationClick);
    onAnnotationClickRef.current = onAnnotationClick;
    const onBlockSelectRef = useRef(onBlockSelect);
    onBlockSelectRef.current = onBlockSelect;

    const stableGetPageTransform = useCallback((p: number) => getPageTransformRef.current(p), []);
    const stableRenderPage = useCallback(
      (canvas: HTMLCanvasElement, p: number, s: number, d: number) => renderPageRef.current(canvas, p, s, d),
      [],
    );
    const stableGetPage = useCallback((p: number) => getPageRef.current(p), []);
    const stableOnAreaSelect = useCallback(
      (p: number, r: { x: number; y: number; width: number; height: number }) => onAreaSelectRef.current(p, r),
      [],
    );
    const stableOnAnnotationHover = useCallback((id: string | null) => onAnnotationHoverRef.current(id), []);
    const stableOnAnnotationClick = useCallback((id: string) => onAnnotationClickRef.current(id), []);
    const stableOnBlockSelect = useCallback((block: ContentBlockDTO) => onBlockSelectRef.current?.(block), []);

    const pages = useMemo(() => {
      const slots: React.ReactNode[] = [];
      for (let i = 1; i <= totalPages; i++) {
        const metadata = pageMetadataMap.get(i);
        if (!metadata) continue;

        const pageAnnotations = annotationsByPage.get(i) ?? [];
        const transform = stableGetPageTransform(i);
        // DLA blocks use 0-based pageIndex
        const pageBlocks = blockMap?.get(i - 1) ?? [];
        const pageOcrLines = ocrLineMap?.get(i - 1);

        slots.push(
          <PageSlot
            key={i}
            pageNumber={i}
            metadata={metadata}
            scale={scale}
            isInFullRender={renderWindow.fullRender.has(i)}
            isInCache={renderWindow.cached.has(i) || renderWindow.fullRender.has(i)}
            annotations={pageAnnotations}
            transform={transform}
            flashingAnnotationId={flashingAnnotationId}
            renderPage={stableRenderPage}
            getPage={stableGetPage}
            onAreaSelect={stableOnAreaSelect}
            onAnnotationHover={stableOnAnnotationHover}
            onAnnotationClick={stableOnAnnotationClick}
            blocks={pageBlocks}
            {...(pageOcrLines ? { ocrLines: pageOcrLines } : {})}
            onBlockSelect={stableOnBlockSelect}
            dragBounds={dragBoundsMap?.get(i)}
          />,
        );
      }
      return slots;
    }, [
      totalPages,
      pageMetadataMap,
      scale,
      renderWindow,
      annotationsByPage,
      flashingAnnotationId,
      stableGetPageTransform,
      stableRenderPage,
      stableGetPage,
      stableOnAreaSelect,
      stableOnAnnotationHover,
      stableOnAnnotationClick,
      stableOnBlockSelect,
      blockMap,
      ocrLineMap,
      dragBoundsMap,
    ]);

    return (
      <div
        ref={scrollContainerRef}
        style={{
          overflowY: 'auto',
          overflowX: isHandTool ? 'auto' : undefined,
          height: '100%',
          flex: 1,
          cursor: isHandTool ? 'grab' : undefined,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: PAGE_GAP,
            paddingTop: PAGE_GAP,
            paddingBottom: PAGE_GAP,
          }}
        >
          {pages}
        </div>
      </div>
    );
  },
);

export { ScrollContainer };
