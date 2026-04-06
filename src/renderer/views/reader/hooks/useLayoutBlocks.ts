/**
 * useLayoutBlocks — subscribe to DLA results for a paper.
 *
 * Manages two data sources:
 * 1. IPC query for already-cached blocks (immediate)
 * 2. Push subscription for new blocks as they're analyzed (streaming)
 *
 * Also triggers DLA analysis on document open and page changes.
 */

import { useState, useEffect, useRef } from 'react';
import type { ContentBlockDTO } from '../../../../shared-types/models';
import { getAPI } from '../../../core/ipc/bridge';

interface DocumentBlocksPayload {
  pageIndex: number;
  blocks: ContentBlockDTO[];
}

export function groupDocumentBlocksByPage(
  pages: DocumentBlocksPayload[],
): Map<number, ContentBlockDTO[]> {
  const grouped = new Map<number, ContentBlockDTO[]>();
  for (const page of pages) {
    if (page.blocks.length === 0) {
      if (!grouped.has(page.pageIndex)) {
        grouped.set(page.pageIndex, []);
      }
      continue;
    }

    for (const block of page.blocks) {
      const targetPageIndex = Number.isInteger(block.pageIndex) ? block.pageIndex : page.pageIndex;
      const existing = grouped.get(targetPageIndex) ?? [];
      existing.push(block);
      grouped.set(targetPageIndex, existing);
    }
  }
  return grouped;
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

    const api = getAPI();
    console.log('[DLA-Hook] Subscribing to dlaPageReady for current document');
    const unsub = api.on.dlaPageReady((event) => {
      if (event.paperId !== paperId) return;

      console.log(`[DLA-Hook] Page ${event.pageIndex} ready: ${event.blocks.length} blocks`);
      setBlockMap((prev) => {
        const next = new Map(prev);
        const normalized = groupDocumentBlocksByPage([{ pageIndex: event.pageIndex, blocks: event.blocks }]);
        for (const [pageIndex, blocks] of normalized) {
          next.set(pageIndex, blocks);
        }
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
    const api = getAPI();

    const loadFromDb = async () => {
      let loaded: Map<number, ContentBlockDTO[]>;
      try {
        const pages = await api.dla.getDocumentBlocks(paperId);
        loaded = groupDocumentBlocksByPage(pages ?? []);
      } catch {
        loaded = new Map();
      }

      if (cancelled || loaded.size === 0) return;

      console.log(`[DLA-Hook] Loaded ${loaded.size} pages from DB for current document`);
      setBlockMap(loaded);
    };

    loadFromDb();
    return () => { cancelled = true; };
  }, [paperId, totalPages, enabled]);

  // Trigger full document analysis on first open (fills in any pages not in DB)
  useEffect(() => {
    if (!paperId || !pdfPath || !enabled || totalPages === 0) return;
    if (triggeredDocRef.current === paperId) return;
    if (blockMap.size >= totalPages) {
      triggeredDocRef.current = paperId;
      return;
    }

    const api = getAPI();
    triggeredDocRef.current = paperId;
    console.log(`[DLA-Hook] Triggering full document analysis for current document (${totalPages} pages)`);
    api.dla.analyzeDocument(paperId, pdfPath, totalPages).catch((err) => {
      console.warn('[DLA-Hook] analyzeDocument failed (non-critical):', err);
    });
  }, [paperId, pdfPath, totalPages, enabled, blockMap]);

  // Boost priority for current page range on scroll
  useEffect(() => {
    if (!paperId || !pdfPath || !enabled || currentPage < 1) return;
    const api = getAPI();

    // Request P0/P1 pages around current viewport
    const nearby: number[] = [];
    for (let i = Math.max(0, currentPage - 3); i < Math.min(totalPages, currentPage + 2); i++) {
      if (!blockMap.has(i)) {
        nearby.push(i);
      }
    }
    if (nearby.length === 0) return;
    api.dla.analyze(paperId, pdfPath, nearby).catch(() => {});
  }, [paperId, pdfPath, currentPage, totalPages, enabled, blockMap]);

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
