import { useCallback, useRef } from 'react';
import { useReaderStore } from '../../../core/store/useReaderStore';
import type { PageMetadataMap } from '../core/pageMetadataPreloader';

export interface ZoomActions {
  zoomIn: () => void;
  zoomOut: () => void;
  setZoomPreset: (value: number | 'fitWidth' | 'fitPage') => void;
  handleWheelZoom: (e: WheelEvent) => void;
}

interface ScrollAnchor {
  page: number;
  pdfX: number;
  pdfY: number;
  viewportFractionX: number;
  viewportFractionY: number;
}

function findAnchorPage(container: HTMLDivElement): ScrollAnchor | null {
  const containerRect = container.getBoundingClientRect();
  const centerX = containerRect.left + containerRect.width / 2;
  const centerY = containerRect.top + containerRect.height / 2;

  const pageElements = container.querySelectorAll('[data-page]');
  for (const el of pageElements) {
    const rect = el.getBoundingClientRect();
    if (
      rect.top <= centerY &&
      rect.bottom >= centerY &&
      rect.left <= centerX &&
      rect.right >= centerX
    ) {
      const pageAttr = el.getAttribute('data-page');
      if (pageAttr === null) continue;

      const page = parseInt(pageAttr, 10);
      if (!Number.isFinite(page)) continue;

      // Fraction within the page element
      const fractionX = (centerX - rect.left) / rect.width;
      const fractionY = (centerY - rect.top) / rect.height;

      return {
        page,
        pdfX: fractionX,
        pdfY: fractionY,
        viewportFractionX: (centerX - containerRect.left) / containerRect.width,
        viewportFractionY: (centerY - containerRect.top) / containerRect.height,
      };
    }
  }

  return null;
}

function restoreScrollPosition(
  container: HTMLDivElement,
  anchor: ScrollAnchor,
): void {
  const containerRect = container.getBoundingClientRect();
  const targetEl = container.querySelector(`[data-page="${anchor.page}"]`);
  if (!targetEl) return;

  const elRect = targetEl.getBoundingClientRect();
  const elTop = elRect.top - containerRect.top + container.scrollTop;
  const elLeft = elRect.left - containerRect.left + container.scrollLeft;

  const pointInElY = anchor.pdfY * elRect.height;
  const pointInElX = anchor.pdfX * elRect.width;

  const targetScrollTop =
    elTop + pointInElY - anchor.viewportFractionY * containerRect.height;
  const targetScrollLeft =
    elLeft + pointInElX - anchor.viewportFractionX * containerRect.width;

  container.scrollTop = targetScrollTop;
  container.scrollLeft = targetScrollLeft;
}

export function useZoom(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  containerWidth: number,
  containerHeight: number,
  pageMetadataMap: PageMetadataMap | null,
): ZoomActions {
  const pendingScrollRestoreRef = useRef<ScrollAnchor | null>(null);

  const captureAnchor = (): ScrollAnchor | null => {
    const container = scrollContainerRef.current;
    if (!container) return null;
    return findAnchorPage(container);
  };

  const scheduleScrollRestore = (anchor: ScrollAnchor | null): void => {
    if (!anchor) return;
    pendingScrollRestoreRef.current = anchor;

    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const pending = pendingScrollRestoreRef.current;
      if (container && pending) {
        restoreScrollPosition(container, pending);
        pendingScrollRestoreRef.current = null;
      }
    });
  };

  const zoomIn = useCallback(() => {
    const anchor = captureAnchor();
    const { zoomLevel, setZoomLevel } = useReaderStore.getState();
    setZoomLevel(Math.min(3.0, Math.round((zoomLevel + 0.1) * 10) / 10));
    scheduleScrollRestore(anchor);
  }, [scrollContainerRef]);

  const zoomOut = useCallback(() => {
    const anchor = captureAnchor();
    const { zoomLevel, setZoomLevel } = useReaderStore.getState();
    setZoomLevel(Math.max(0.5, Math.round((zoomLevel - 0.1) * 10) / 10));
    scheduleScrollRestore(anchor);
  }, [scrollContainerRef]);

  const setZoomPreset = useCallback(
    (value: number | 'fitWidth' | 'fitPage') => {
      const anchor = captureAnchor();
      const { currentPage, setZoomLevel, setZoomMode } = useReaderStore.getState();

      if (typeof value === 'number') {
        setZoomMode('custom');
        setZoomLevel(value);
      } else if (value === 'fitWidth') {
        setZoomMode('fitWidth');
        const meta = pageMetadataMap?.get(currentPage);
        if (meta) {
          const scale = containerWidth / meta.baseWidth;
          setZoomLevel(scale);
        }
      } else if (value === 'fitPage') {
        setZoomMode('fitPage');
        const meta = pageMetadataMap?.get(currentPage);
        if (meta) {
          const scale = Math.min(
            containerWidth / meta.baseWidth,
            containerHeight / meta.baseHeight,
          );
          setZoomLevel(scale);
        }
      }

      scheduleScrollRestore(anchor);
    },
    [scrollContainerRef, containerWidth, containerHeight, pageMetadataMap],
  );

  const handleWheelZoom = useCallback(
    (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      e.preventDefault();

      const anchor = captureAnchor();
      const { zoomLevel, setZoomLevel } = useReaderStore.getState();

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.round((zoomLevel + delta) * 10) / 10;
      setZoomLevel(Math.max(0.5, Math.min(3.0, newZoom)));

      scheduleScrollRestore(anchor);
    },
    [scrollContainerRef],
  );

  return { zoomIn, zoomOut, setZoomPreset, handleWheelZoom };
}
