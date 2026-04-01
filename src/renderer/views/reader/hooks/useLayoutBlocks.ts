/**
 * useLayoutBlocks — subscribe to DLA results for a paper.
 *
 * Manages two data sources:
 * 1. IPC query for already-cached blocks (immediate)
 * 2. Push subscription for new blocks as they're analyzed (streaming)
 *
 * Also triggers DLA analysis on document open and page changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ContentBlockDTO } from '../../../../shared-types/models';

declare global {
  interface Window {
    abyssal: {
      dla: {
        analyze: (paperId: string, pdfPath: string, pageIndices: number[]) => Promise<void>;
        getBlocks: (paperId: string, pageIndex: number) => Promise<ContentBlockDTO[] | null>;
        analyzeDocument: (paperId: string, pdfPath: string, totalPages: number) => Promise<void>;
      };
      on: {
        dlaPageReady: (cb: (event: {
          paperId: string;
          pageIndex: number;
          blocks: ContentBlockDTO[];
        }) => void) => () => void;
      };
      [key: string]: unknown;
    };
  }
}

interface UseLayoutBlocksOptions {
  paperId: string | null;
  pdfPath: string | null;
  totalPages: number;
  /** Currently visible page (1-based) */
  currentPage: number;
  /** Whether DLA is enabled */
  enabled?: boolean;
}

/**
 * Returns a Map of pageIndex → ContentBlockDTO[] for the current document.
 * Automatically triggers analysis and subscribes to streaming results.
 */
export function useLayoutBlocks(opts: UseLayoutBlocksOptions): Map<number, ContentBlockDTO[]> {
  const { paperId, pdfPath, totalPages, currentPage, enabled = true } = opts;
  const [blockMap, setBlockMap] = useState<Map<number, ContentBlockDTO[]>>(new Map());
  const triggeredDocRef = useRef<string | null>(null);

  // Subscribe to push:dlaPageReady events
  useEffect(() => {
    if (!paperId || !enabled) return;

    console.log(`[DLA-Hook] Subscribing to dlaPageReady for paper=${paperId.slice(0, 8)}`);
    const unsub = window.abyssal?.on?.dlaPageReady?.((event) => {
      if (event.paperId !== paperId) return;

      console.log(`[DLA-Hook] Page ${event.pageIndex} ready: ${event.blocks.length} blocks`);
      setBlockMap((prev) => {
        const next = new Map(prev);
        next.set(event.pageIndex, event.blocks);
        return next;
      });
    });

    return () => { unsub?.(); };
  }, [paperId, enabled]);

  // Clear cache on document change
  useEffect(() => {
    setBlockMap(new Map());
    triggeredDocRef.current = null;
  }, [paperId]);

  // DB-first: attempt to load persisted layout blocks before triggering live DLA
  useEffect(() => {
    if (!paperId || !enabled || totalPages === 0) return;

    let cancelled = false;

    const loadFromDb = async () => {
      // Try loading each page's blocks from DB (which checks persisted data first)
      const loaded = new Map<number, ContentBlockDTO[]>();
      for (let i = 0; i < totalPages; i++) {
        try {
          const blocks = await window.abyssal?.dla?.getBlocks?.(paperId, i);
          if (blocks && blocks.length > 0 && !cancelled) {
            loaded.set(i, blocks);
          }
        } catch {
          break; // DB unavailable, stop trying
        }
      }

      if (cancelled || loaded.size === 0) return;

      console.log(`[DLA-Hook] Loaded ${loaded.size} pages from DB for paper=${paperId.slice(0, 8)}`);
      setBlockMap((prev) => {
        const next = new Map(prev);
        for (const [pageIdx, blocks] of loaded) {
          if (!next.has(pageIdx)) next.set(pageIdx, blocks);
        }
        return next;
      });
    };

    loadFromDb();
    return () => { cancelled = true; };
  }, [paperId, totalPages, enabled]);

  // Trigger full document analysis on first open (fills in any pages not in DB)
  useEffect(() => {
    if (!paperId || !pdfPath || !enabled || totalPages === 0) return;
    if (triggeredDocRef.current === paperId) return;

    triggeredDocRef.current = paperId;
    console.log(`[DLA-Hook] Triggering full document analysis for paper=${paperId.slice(0, 8)} (${totalPages} pages)`);
    window.abyssal?.dla?.analyzeDocument?.(paperId, pdfPath, totalPages)?.catch((err) => {
      console.warn('[DLA-Hook] analyzeDocument failed (non-critical):', err);
    });
  }, [paperId, pdfPath, totalPages, enabled]);

  // Boost priority for current page range on scroll
  useEffect(() => {
    if (!paperId || !pdfPath || !enabled || currentPage < 1) return;

    // Request P0/P1 pages around current viewport
    const nearby: number[] = [];
    for (let i = Math.max(0, currentPage - 3); i < Math.min(totalPages, currentPage + 2); i++) {
      nearby.push(i);
    }
    window.abyssal?.dla?.analyze?.(paperId, pdfPath, nearby)?.catch(() => {});
  }, [paperId, pdfPath, currentPage, totalPages, enabled]);

  return blockMap;
}

/**
 * Get blocks for a specific page from the block map.
 * Returns empty array if page hasn't been analyzed yet.
 */
export function getPageBlocks(
  blockMap: Map<number, ContentBlockDTO[]>,
  pageIndex: number,
): ContentBlockDTO[] {
  return blockMap.get(pageIndex) ?? [];
}
