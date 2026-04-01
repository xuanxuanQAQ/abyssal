import { useEffect, useRef } from 'react';
import { useReaderStore } from '../../../core/store/useReaderStore';
import { useAppStore } from '../../../core/store';
import { emitUserAction } from '../../../core/hooks/useEventBridge';

export function useCurrentPage(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  totalPages: number,
): void {
  const ratioMapRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || totalPages === 0) {
      return;
    }

    const ratioMap = ratioMapRef.current;
    ratioMap.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageAttr = (entry.target as HTMLElement).getAttribute('data-page');
          if (pageAttr === null) continue;

          const pageNum = parseInt(pageAttr, 10);
          if (!Number.isFinite(pageNum)) continue;

          ratioMap.set(pageNum, entry.intersectionRatio);
        }

        // Find the page with the highest intersection ratio
        let bestPage = -1;
        let bestRatio = -1;

        for (const [page, ratio] of ratioMap) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = page;
          }
        }

        if (bestPage > 0) {
          const currentPage = useReaderStore.getState().currentPage;
          if (currentPage !== bestPage) {
            useReaderStore.getState().setCurrentPage(bestPage);
            const paperId = useAppStore.getState().selectedPaperId;
            if (paperId) {
              emitUserAction({ action: 'pageChange', paperId, page: bestPage, totalPages });
            }
          }
        }
      },
      {
        root: container,
        threshold: [0, 0.1, 0.5, 1.0],
      },
    );

    const pageElements = container.querySelectorAll('[data-page]');
    for (const el of pageElements) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      ratioMap.clear();
    };
  }, [scrollContainerRef, totalPages]);
}
