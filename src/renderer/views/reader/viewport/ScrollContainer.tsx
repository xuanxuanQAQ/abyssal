import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useState,
} from 'react';
import { PageSlot } from './PageSlot';
import type { PageMetadataMap } from '../core/pageMetadataPreloader';
import type { RenderWindowResult } from '../core/renderWindow';
import type { Annotation } from '../../../../shared-types/models';
import type { Transform6 } from '../math/coordinateTransform';
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
  ) => Promise<void>;
  getPage: (pageNumber: number) => Promise<any>;
  onAreaSelect: (
    pageNumber: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onAnnotationHover: (id: string | null) => void;
  onAnnotationClick: (id: string) => void;
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

    const pages = useMemo(() => {
      const slots: React.ReactNode[] = [];
      for (let i = 1; i <= totalPages; i++) {
        const metadata = pageMetadataMap.get(i);
        if (!metadata) continue;

        const pageAnnotations = annotationsByPage.get(i) ?? [];
        const transform = getPageTransform(i);

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
            renderPage={renderPage}
            getPage={getPage}
            onAreaSelect={onAreaSelect}
            onAnnotationHover={onAnnotationHover}
            onAnnotationClick={onAnnotationClick}
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
      getPageTransform,
      renderPage,
      getPage,
      onAreaSelect,
      onAnnotationHover,
      onAnnotationClick,
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
