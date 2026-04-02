/**
 * DLA Scheduler — manages page analysis priority and caching.
 *
 * Priority scheme:
 * - P0: Current visible page
 * - P1: Visible window pages
 * - P2: Cached/nearby pages
 * - P3: Remaining pages (background)
 *
 * Results are cached in memory (Map<paperId, Map<pageIndex, ContentBlock[]>>).
 * Cache is cleared when a document is closed.
 */

import type { ContentBlock } from './types';
import type { DlaProxy, PageAnalysisEvent } from './dla-proxy';
import type { Logger } from '../infra/logger';

export interface SchedulerOptions {
  /** Max pages to hold in cache per document (default: 500) */
  maxCachedPagesPerDoc?: number;
  /** Max batch size for interactive analysis (default: 4) */
  batchSize?: number;
  /** Batch size for background full-document analysis (default: 1) */
  backgroundBatchSize?: number;
}

interface AnalysisJob {
  paperId: string;
  pdfPath: string;
  pageIndices: number[];
  priority: number;
}

export class DlaScheduler {
  private proxy: DlaProxy;
  private logger: Logger;
  private opts: Required<SchedulerOptions>;

  /** paperId → (pageIndex → ContentBlock[]) */
  private cache = new Map<string, Map<number, ContentBlock[]>>();

  /** Currently running job's paperId, or null */
  private activeJob: string | null = null;

  /** Pending jobs queue (sorted by priority) */
  private queue: AnalysisJob[] = [];

  /** Callbacks waiting for specific page results */
  private pageCallbacks = new Map<string, Array<(blocks: ContentBlock[]) => void>>();

  /** Subscriber for push notifications */
  private onPageReady: ((paperId: string, pageIndex: number, blocks: ContentBlock[]) => void) | null = null;

  /** Number of consecutive restart attempts (reset on success) */
  private restartAttempts = 0;
  private static MAX_RESTART_ATTEMPTS = 3;

  constructor(proxy: DlaProxy, logger: Logger, opts: SchedulerOptions = {}) {
    this.proxy = proxy;
    this.logger = logger;
    this.opts = {
      maxCachedPagesPerDoc: opts.maxCachedPagesPerDoc ?? 500,
      batchSize: opts.batchSize ?? 4,
      backgroundBatchSize: opts.backgroundBatchSize ?? 1,
    };

    // Listen for per-page results from proxy
    proxy.on('page', (event: PageAnalysisEvent) => {
      this.restartAttempts = 0; // healthy — reset counter
      this.handlePageResult(event);
    });

    // When proxy becomes ready, flush any jobs that arrived before init
    proxy.on('ready', () => {
      this.logger.info('[DLA-Scheduler] Proxy ready — flushing queued jobs');
      this.processNext();
    });

    // Listen for subprocess crashes and attempt restart
    proxy.on('error', (err: Error) => {
      this.logger.warn('[DLA-Scheduler] Proxy error', { error: err.message });
      if (!proxy.initialized && this.restartAttempts < DlaScheduler.MAX_RESTART_ATTEMPTS) {
        this.restartAttempts++;
        this.logger.info(`[DLA-Scheduler] Attempting restart (${this.restartAttempts}/${DlaScheduler.MAX_RESTART_ATTEMPTS})`);
        proxy.start().then(() => {
          this.logger.info('[DLA-Scheduler] Subprocess restarted successfully');
          this.processNext();
        }).catch((restartErr: Error) => {
          this.logger.warn('[DLA-Scheduler] Restart failed', { error: restartErr.message });
        });
      }
    });
  }

  /** Register a callback for page-ready push notifications */
  setPageReadyCallback(
    cb: (paperId: string, pageIndex: number, blocks: ContentBlock[]) => void,
  ): void {
    this.onPageReady = cb;
  }

  /** Get cached blocks for a page, or null if not yet analyzed */
  getCachedBlocks(paperId: string, pageIndex: number): ContentBlock[] | null {
    return this.cache.get(paperId)?.get(pageIndex) ?? null;
  }

  /** Get all cached blocks for a document */
  getAllCachedBlocks(paperId: string): Map<number, ContentBlock[]> | null {
    return this.cache.get(paperId) ?? null;
  }

  /**
   * Request analysis of specific pages with priority.
   * Pages already cached are skipped.
   */
  requestPages(
    paperId: string,
    pdfPath: string,
    pageIndices: number[],
    priority: number = 2,
  ): void {
    // Filter out already-cached pages
    const docCache = this.cache.get(paperId);
    const uncached = pageIndices.filter((i) => !docCache?.has(i));
    if (uncached.length === 0) {
      this.logger.debug?.(`[DLA-Scheduler] All ${pageIndices.length} pages cached for ${paperId.slice(0, 8)}`);
      return;
    }
    this.logger.info(`[DLA-Scheduler] Queuing ${uncached.length} pages (P${priority}) for ${paperId.slice(0, 8)}`);

    // Add to queue (or merge with existing job)
    const existingIdx = this.queue.findIndex(
      (j) => j.paperId === paperId && j.priority === priority,
    );

    if (existingIdx >= 0) {
      const existing = this.queue[existingIdx]!;
      const merged = new Set([...existing.pageIndices, ...uncached]);
      existing.pageIndices = Array.from(merged);
    } else {
      this.queue.push({ paperId, pdfPath, pageIndices: uncached, priority });
    }

    // Sort by priority (lower = higher priority)
    this.queue.sort((a, b) => a.priority - b.priority);

    // Kick processing if idle
    this.processNext();
  }

  /**
   * Request full document analysis in background.
   * Current/visible pages should be requested separately with higher priority.
   */
  requestFullDocument(
    paperId: string,
    pdfPath: string,
    totalPages: number,
  ): void {
    const allPages = Array.from({ length: totalPages }, (_, i) => i);
    this.requestPages(paperId, pdfPath, allPages, 3);
  }

  /** Update priority for pages near the current viewport */
  notifyPageChanged(
    paperId: string,
    pdfPath: string,
    currentPage: number,
    totalPages: number,
  ): void {
    // P0: current page (0-based)
    const p0 = [currentPage - 1];
    // P1: ±2 pages
    const p1 = [];
    for (let i = Math.max(0, currentPage - 3); i < Math.min(totalPages, currentPage + 2); i++) {
      if (i !== currentPage - 1) p1.push(i);
    }

    this.requestPages(paperId, pdfPath, p0, 0);
    this.requestPages(paperId, pdfPath, p1, 1);
  }

  /** Clear cache for a document (called on document close) */
  clearDocument(paperId: string): void {
    this.cache.delete(paperId);
    this.queue = this.queue.filter((j) => j.paperId !== paperId);
    this.pageCallbacks.forEach((_v, key) => {
      if (key.startsWith(`${paperId}:`)) {
        this.pageCallbacks.delete(key);
      }
    });
  }

  /** Clear all caches */
  clearAll(): void {
    this.cache.clear();
    this.queue = [];
    this.pageCallbacks.clear();
  }

  // ─── Internal ───

  private handlePageResult(event: PageAnalysisEvent): void {
    // Find which paperId this belongs to
    const paperId = this.activeJob;
    if (!paperId) return;

    this.logger.info(`[DLA-Scheduler] Cached page ${event.pageIndex} for ${paperId.slice(0, 8)} (${event.blocks.length} blocks, ${event.inferenceMs}ms)`);

    // Store in cache
    let docCache = this.cache.get(paperId);
    if (!docCache) {
      docCache = new Map();
      this.cache.set(paperId, docCache);
    }
    docCache.set(event.pageIndex, event.blocks);

    // Enforce cache limit (LRU eviction of oldest pages)
    if (docCache.size > this.opts.maxCachedPagesPerDoc) {
      const firstKey = docCache.keys().next().value;
      if (firstKey !== undefined) docCache.delete(firstKey);
    }

    // Resolve page-specific callbacks
    const cbKey = `${paperId}:${event.pageIndex}`;
    const cbs = this.pageCallbacks.get(cbKey);
    if (cbs) {
      for (const cb of cbs) cb(event.blocks);
      this.pageCallbacks.delete(cbKey);
    }

    // Push notification
    this.onPageReady?.(paperId, event.pageIndex, event.blocks);
  }

  private async processNext(): Promise<void> {
    if (this.activeJob) return; // Already processing
    if (this.queue.length === 0) return;
    if (!this.proxy.initialized) return;

    const job = this.queue.shift()!;

    // Re-filter: some pages may have been cached while waiting
    const docCache = this.cache.get(job.paperId);
    const uncached = job.pageIndices.filter((i) => !docCache?.has(i));
    if (uncached.length === 0) {
      // All done, try next
      this.processNext();
      return;
    }

    // Take a batch
    const batchSize = this.getBatchSize(job.priority);
    const batch = uncached.slice(0, batchSize);
    const remaining = uncached.slice(batchSize);

    // Put remaining back
    if (remaining.length > 0) {
      this.queue.unshift({ ...job, pageIndices: remaining });
    }

    this.activeJob = job.paperId;
    this.logger.info(`[DLA-Scheduler] Processing batch: pages=[${batch.join(',')}] for ${job.paperId.slice(0, 8)}`);

    try {
      await this.proxy.detect(job.pdfPath, batch);
    } catch (err) {
      this.logger.warn('[DLA-Scheduler] Batch failed', {
        paperId: job.paperId,
        pages: batch,
        error: (err as Error).message,
      });
    } finally {
      this.activeJob = null;
      // Process next batch
      this.processNext();
    }
  }

  private getBatchSize(priority: number): number {
    if (priority >= 3) {
      return this.opts.backgroundBatchSize;
    }
    if (priority <= 0) {
      return Math.min(2, this.opts.batchSize);
    }
    if (priority === 1) {
      return Math.min(3, this.opts.batchSize);
    }
    return this.opts.batchSize;
  }
}
