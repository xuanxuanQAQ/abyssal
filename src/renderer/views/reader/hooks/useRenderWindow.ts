import { useMemo } from 'react';
import { useReaderStore } from '../../../core/store/useReaderStore';
import { computeRenderWindow, type RenderWindowResult } from '../core/renderWindow';
import { MemoryBudget } from '../core/memoryBudget';

export function useRenderWindow(
  totalPages: number,
  memoryBudget: MemoryBudget | null,
): RenderWindowResult {
  const currentPage = useReaderStore((s) => s.currentPage);
  const zoomLevel = useReaderStore((s) => s.zoomLevel);

  return useMemo(() => {
    const cacheRange = memoryBudget?.getRecommendedCacheRange(zoomLevel) ?? 4;

    return computeRenderWindow(currentPage, totalPages, {
      fullRenderRange: 2,
      cacheRange,
    });
  }, [currentPage, totalPages, zoomLevel, memoryBudget]);
}
