/**
 * useOcrLines — subscribe to OCR line-level bbox data for a paper.
 *
 * Used by the reader to determine whether to render OcrTextLayer
 * (for scanned pages with OCR data) vs. the default pdf.js TextLayer.
 *
 * Follows the same pattern as useLayoutBlocks:
 * 1. DB-first load of persisted OCR lines
 * 2. Returns a Map of pageIndex → OcrLineDTO[]
 */

import { useState, useEffect } from 'react';
import type { OcrLineDTO } from '../../../../shared-types/models';
import { getAPI } from '../../../core/ipc/bridge';

interface UseOcrLinesOptions {
  paperId: string | null;
  totalPages: number;
  enabled?: boolean;
}

/**
 * Returns a Map of pageIndex → OcrLineDTO[] for pages that have OCR line data.
 * Pages present in this map should use OcrTextLayer instead of pdf.js TextLayer.
 */
export function useOcrLines(opts: UseOcrLinesOptions): Map<number, OcrLineDTO[]> {
  const { paperId, totalPages, enabled = true } = opts;
  const [ocrLineMap, setOcrLineMap] = useState<Map<number, OcrLineDTO[]>>(new Map());

  // Clear on document change
  useEffect(() => {
    setOcrLineMap(new Map());
  }, [paperId]);

  // DB-first: load persisted OCR lines
  useEffect(() => {
    if (!paperId || !enabled || totalPages === 0) return;

    let cancelled = false;
    const api = getAPI();

    const loadFromDb = async () => {
      let pages: Array<{ pageIndex: number; lines: OcrLineDTO[] }>;
      try {
        pages = await api.dla.getDocumentOcrLines(paperId);
      } catch {
        pages = [];
      }

      if (cancelled || pages.length === 0) return;

      const grouped = new Map<number, OcrLineDTO[]>();
      for (const page of pages) {
        grouped.set(page.pageIndex, page.lines);
      }

      console.log(`[OCR-Hook] Loaded OCR lines for ${grouped.size} pages in current document`);
      setOcrLineMap(grouped);
    };

    loadFromDb();
    return () => { cancelled = true; };
  }, [paperId, totalPages, enabled]);

  return ocrLineMap;
}
