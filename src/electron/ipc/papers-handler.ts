/**
 * IPC handler: papers namespace
 *
 * Contract channels: db:papers:list, db:papers:get, db:papers:update,
 *   db:papers:batchUpdateRelevance, db:papers:importBibtex, db:papers:counts,
 *   db:papers:delete, db:papers:batchDelete
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import type { PaperMetadata } from '../../core/types/paper';
import { asPaperId } from '../../core/types/common';
import type { Paper } from '../../shared-types/models';

/** Convert backend PaperMetadata to frontend Paper shape */
function paperToFrontend(p: PaperMetadata): Paper {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors.map((a) => {
      const parts = a.split(',').map((s) => s.trim());
      return { name: a, family: parts[0] ?? a, given: parts[1] ?? '' };
    }),
    year: p.year,
    abstract: p.abstract,
    doi: p.doi,
    paperType: p.paperType,
    relevance: 'medium',
    fulltextStatus:
      (p as any)['fulltextStatus'] ?? 'not_attempted',
    analysisStatus:
      (p as any)['analysisStatus'] ?? 'not_started',
    decisionNote: null,
    tags: [],
    dateAdded:
      ((p as any)['createdAt'] as string) ??
      new Date().toISOString(),
    analysisReport: null,
  };
}

export function registerPapersHandlers(ctx: AppContext): void {
  const { logger, dbProxy } = ctx;

  // ── db:papers:list ──
  typedHandler('db:papers:list', logger, async (_e, filter) => {
    const result = (await dbProxy.queryPapers(
      (filter as Record<string, unknown>) ?? {},
    )) as { items: PaperMetadata[] };
    return result.items.map(paperToFrontend);
  });

  // ── db:papers:get ──
  typedHandler('db:papers:get', logger, async (_e, id) => {
    const paper = await dbProxy.getPaper(asPaperId(id));
    if (!paper) throw new Error(`Paper not found: ${id}`);
    return paperToFrontend(paper);
  });

  // ── db:papers:update ──
  typedHandler('db:papers:update', logger, async (_e, id, patch) => {
    await dbProxy.updatePaper(asPaperId(id), patch as any);
  });

  // ── db:papers:batchUpdateRelevance ──
  typedHandler('db:papers:batchUpdateRelevance', logger, async () => {
    // TODO: papers table has no relevance column yet
  });

  // ── db:papers:importBibtex ──
  typedHandler('db:papers:importBibtex', logger, async (_e, content) => {
    if (!ctx.bibliographyModule) throw new Error('Bibliography service not initialized');
    const entries = ctx.bibliographyModule.importBibtex(content);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const entry of entries) {
      try {
        await dbProxy.addPaper(entry.metadata as PaperMetadata);
        imported++;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('UNIQUE') || msg.includes('duplicate')) skipped++;
        else errors.push(`${entry.originalKey}: ${msg}`);
      }
    }
    logger.info('BibTeX import complete', { imported, skipped, errors: errors.length });
    return { imported, skipped, errors };
  });

  // ── db:papers:counts ──
  typedHandler('db:papers:counts', logger, async () => {
    const stats = (await dbProxy.getStats()) as { papers: { total: number } };
    return {
      total: stats.papers.total,
      byRelevance: { seed: 0, high: 0, medium: stats.papers.total, low: 0, excluded: 0 },
      byAnalysisStatus: { not_started: stats.papers.total, in_progress: 0, completed: 0, needs_review: 0, failed: 0 },
      byFulltextStatus: { available: 0, pending: 0, failed: 0, not_attempted: stats.papers.total },
    };
  });

  // ── db:papers:delete ──
  typedHandler('db:papers:delete', logger, async (_e, id) => {
    await dbProxy.deletePaper(asPaperId(id));
  });

  // ── db:papers:batchDelete ──
  typedHandler('db:papers:batchDelete', logger, async (_e, ids) => {
    for (const id of ids) {
      try { await dbProxy.deletePaper(asPaperId(id)); } catch { /* ignore */ }
    }
  });
}
