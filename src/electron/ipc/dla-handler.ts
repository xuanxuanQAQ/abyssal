/**
 * DLA IPC handlers — document layout analysis channels.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import type { ContentBlockDTO } from '../../shared-types/models';

export function registerDlaHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('dla:analyze', logger, async (_e, paperId, pdfPath, pageIndices) => {
    if (!ctx.dlaScheduler) {
      logger.warn('[DLA-IPC] dla:analyze — scheduler not initialized');
      return;
    }
    logger.info(`[DLA-IPC] dla:analyze paper=${paperId.slice(0, 8)} pages=[${pageIndices.join(',')}]`);
    ctx.dlaScheduler.requestPages(paperId, pdfPath, pageIndices, 0);
  });

  typedHandler('dla:getBlocks', logger, async (_e, paperId, pageIndex): Promise<ContentBlockDTO[] | null> => {
    // DB-first: check persisted layout blocks before in-memory cache
    try {
      const proxy = ctx.dbProxy as Record<string, (...args: unknown[]) => Promise<unknown>>;
      if (typeof proxy['getLayoutBlocksByPage'] === 'function') {
        const dbRows = await proxy['getLayoutBlocksByPage'](paperId, pageIndex) as Array<Record<string, unknown>> | null;
        if (dbRows && dbRows.length > 0) {
          logger.debug?.(`[DLA-IPC] dla:getBlocks DB hit paper=${paperId.slice(0, 8)} page=${pageIndex} (${dbRows.length} blocks)`);
          return dbRows.map((row): ContentBlockDTO => {
            // DAO returns LayoutBlockRow with camelCase fields and nested bbox
            const bbox = row['bbox'] as { x: number; y: number; w: number; h: number } | undefined;
            return {
              type: (row['blockType'] as string ?? row['block_type'] as string) as ContentBlockDTO['type'],
              bbox: bbox
                ? { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }
                : { x: row['bbox_x'] as number, y: row['bbox_y'] as number, w: row['bbox_w'] as number, h: row['bbox_h'] as number },
              confidence: (row['confidence'] as number) ?? 0,
              pageIndex: (row['pageIndex'] as number) ?? (row['page_index'] as number) ?? 0,
            };
          });
        }
      }
    } catch {
      // DB query failed (migration not yet applied) — fall through to cache
    }

    // Fallback to in-memory scheduler cache
    if (!ctx.dlaScheduler) return null;

    const blocks = ctx.dlaScheduler.getCachedBlocks(paperId, pageIndex);
    if (!blocks) {
      logger.debug?.(`[DLA-IPC] dla:getBlocks cache miss paper=${paperId.slice(0, 8)} page=${pageIndex}`);
      return null;
    }

    logger.debug?.(`[DLA-IPC] dla:getBlocks cache hit paper=${paperId.slice(0, 8)} page=${pageIndex} (${blocks.length} blocks)`);
    return blocks.map((b) => ({
      type: b.type,
      bbox: { x: b.bbox.x, y: b.bbox.y, w: b.bbox.w, h: b.bbox.h },
      confidence: b.confidence,
      pageIndex: b.pageIndex,
    }));
  });

  typedHandler('dla:analyzeDocument', logger, async (_e, paperId, pdfPath, totalPages) => {
    if (!ctx.dlaScheduler) {
      logger.warn('[DLA-IPC] dla:analyzeDocument — scheduler not initialized');
      return;
    }
    logger.info(`[DLA-IPC] dla:analyzeDocument paper=${paperId.slice(0, 8)} totalPages=${totalPages}`);
    ctx.dlaScheduler.requestFullDocument(paperId, pdfPath, totalPages);
  });
}
