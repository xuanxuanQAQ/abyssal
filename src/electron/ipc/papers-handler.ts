/**
 * IPC handler: papers namespace
 *
 * Contract channels: db:papers:list, db:papers:get, db:papers:update,
 *   db:papers:batchUpdateRelevance, db:papers:importBibtex, db:papers:counts,
 *   db:papers:delete, db:papers:batchDelete, db:papers:linkPdf, db:papers:resetAnalysis
 */

import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { dialog } from 'electron';
import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import type { PaperMetadata } from '../../core/types/paper';
import { asPaperId } from '../../core/types/common';
import type { Paper } from '../../shared-types/models';
import { validatePdf } from '../../core/acquire';
import { insertBibEntries } from './shared/import-bibtex';

/** Read analysis report markdown from disk (best-effort, async) */
async function readAnalysisReport(
  analysisPath: string | null | undefined,
  paperId: string,
  workspaceRoot: string,
): Promise<string | null> {
  if (analysisPath) {
    try { return await fs.readFile(analysisPath, 'utf-8'); } catch { /* fall through */ }
  }
  const conventionalPath = path.join(workspaceRoot, 'analyses', `${paperId}.md`);
  try { return await fs.readFile(conventionalPath, 'utf-8'); } catch { return null; }
}

/** Convert backend PaperMetadata to frontend Paper shape */
async function paperToFrontend(p: PaperMetadata, workspaceRoot: string): Promise<Paper> {
  const raw = p as any;
  const analysisStatus = raw['analysisStatus'] ?? 'not_started';
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
    arxivId: p.arxivId ?? null,
    pmcid: p.pmcid ?? null,
    paperType: p.paperType,
    relevance: raw['relevance'] ?? 'medium',
    fulltextStatus: raw['fulltextStatus'] ?? 'not_attempted',
    fulltextPath: raw['fulltextPath'] ?? null,
    fulltextSource: raw['fulltextSource'] ?? null,
    textPath: raw['textPath'] ?? null,
    analysisStatus,
    decisionNote: raw['decisionNote'] ?? null,
    failureReason: raw['failureReason'] ?? null,
    failureCount: raw['failureCount'] ?? 0,
    tags: raw['tags'] ?? [],
    dateAdded: (raw['discoveredAt'] as string) ?? new Date().toISOString(),
    analysisReport: analysisStatus === 'completed'
      ? await readAnalysisReport(raw['analysisPath'] as string | null, p.id, workspaceRoot)
      : null,
  };
}

export function registerPapersHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── db:papers:list ──
  typedHandler('db:papers:list', logger, async (_e, filter) => {
    const result = (await ctx.dbProxy.queryPapers(
      (filter as Record<string, unknown>) ?? {},
    )) as { items: PaperMetadata[] };
    return await Promise.all(result.items.map((p) => paperToFrontend(p, ctx.workspaceRoot)));
  });

  // ── db:papers:get ──
  typedHandler('db:papers:get', logger, async (_e, id) => {
    const paper = await ctx.dbProxy.getPaper(asPaperId(id));
    if (!paper) throw new Error(`Paper not found: ${id}`);
    return await paperToFrontend(paper, ctx.workspaceRoot);
  });

  // ── db:papers:update ──
  typedHandler('db:papers:update', logger, async (_e, id, patch) => {
    await ctx.dbProxy.updatePaper(asPaperId(id), patch as any);
    ctx.pushManager?.enqueueDbChange(['papers'], 'update', { papers: [id] });
  });

  // ── db:papers:batchUpdateRelevance ──
  typedHandler('db:papers:batchUpdateRelevance', logger, async (_e, ids, rel) => {
    for (const id of ids) {
      await ctx.dbProxy.updatePaper(asPaperId(id), { relevance: rel } as any);
    }
    ctx.pushManager?.enqueueDbChange(['papers'], 'update', { papers: ids as string[] });
  });

  // ── db:papers:importBibtex ──
  typedHandler('db:papers:importBibtex', logger, async (_e, content) => {
    if (!ctx.bibliographyModule) throw new Error('Bibliography service not initialized');
    const entries = ctx.bibliographyModule.importBibtex(content);
    const result = await insertBibEntries(ctx.dbProxy, entries);
    if (result.imported > 0) {
      ctx.pushManager?.enqueueDbChange(['papers'], 'insert');
    }
    logger.info('BibTeX import complete', { imported: result.imported, skipped: result.skipped, errors: result.errors.length });
    return result;
  });

  // ── db:papers:counts ──
  typedHandler('db:papers:getCounts', logger, async () => {
    const stats = await ctx.dbProxy.getStats() as { papers: import('../../core/database/dao/stats').DatabaseStats['papers'] };
    const p = stats.papers;
    return {
      total: p.total,
      byRelevance: {
        seed: p.relevanceSeed,
        high: p.relevanceHigh,
        medium: p.relevanceMedium,
        low: p.relevanceLow,
        excluded: p.relevanceExcluded,
      },
      byAnalysisStatus: {
        not_started: p.analysisNotStarted,
        in_progress: p.analysisInProgress,
        completed: p.analysisCompleted,
        needs_review: p.analysisNeedsReview,
        failed: p.analysisFailed,
      },
      byFulltextStatus: {
        not_attempted: p.fulltextNotAttempted,
        pending: p.fulltextPending,
        available: p.fulltextAvailable,
        abstract_only: p.fulltextAbstractOnly,
        failed: p.fulltextFailed,
      },
    };
  });

  // ── db:papers:delete ──
  typedHandler('db:papers:delete', logger, async (_e, id) => {
    await ctx.dbProxy.deletePaper(asPaperId(id));
  });

  // ── db:papers:batchDelete ──
  typedHandler('db:papers:batchDelete', logger, async (_e, ids) => {
    const errors: string[] = [];
    for (const id of ids) {
      try { await ctx.dbProxy.deletePaper(asPaperId(id)); }
      catch (err) { errors.push(`${id}: ${(err as Error).message}`); }
    }
    if (errors.length > 0) {
      logger.warn('Batch delete partial failures', { errors });
    }
  });

  // ── db:papers:linkPdf ──
  typedHandler('db:papers:linkPdf', logger, async (_e, paperId, pdfPath?) => {
    let sourcePath = pdfPath as string | null | undefined;
    if (!sourcePath) {
      const result = await dialog.showOpenDialog({
        title: '选择 PDF 文件',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) return;
      sourcePath = result.filePaths[0]!;
    }

    if (!existsSync(sourcePath)) {
      throw new Error(`File not found: ${sourcePath}`);
    }
    const validation = await validatePdf(sourcePath);
    if (!validation.valid) {
      throw new Error(`Invalid PDF file: ${validation.reason ?? 'unknown'}`);
    }

    const pdfDir = path.join(ctx.workspaceRoot, 'pdfs');
    await fs.mkdir(pdfDir, { recursive: true });
    const destPath = path.join(pdfDir, `${paperId}.pdf`);

    const tmpPath = destPath + '.tmp';
    await fs.copyFile(sourcePath, tmpPath);
    await fs.rename(tmpPath, destPath);

    await ctx.dbProxy.updatePaper(asPaperId(paperId), {
      fulltextPath: destPath,
      fulltextStatus: 'pending',
      fulltextSource: 'manual',
      failureReason: null,
      failureCount: 0,
    } as any);

    ctx.pushManager?.enqueueDbChange(['papers'], 'update', { papers: [paperId] });
    logger.info('Local PDF linked to paper', { paperId, sourcePath, destPath });
  });

  // ── db:papers:resetAnalysis ──
  typedHandler('db:papers:resetAnalysis', logger, async (_e, id) => {
    const analysisPath = await ctx.dbProxy.resetAnalysis(asPaperId(id)) as string | null;
    if (analysisPath) {
      try { await fs.unlink(analysisPath); } catch { /* ignore */ }
    }
    const conventionalPath = path.join(ctx.workspaceRoot, 'analyses', `${id}.md`);
    try { await fs.unlink(conventionalPath); } catch { /* ignore */ }
    try { await fs.unlink(path.join(ctx.workspaceRoot, 'analyses', `${id}.reasoning.txt`)); } catch { /* ignore */ }
    try { await fs.unlink(path.join(ctx.workspaceRoot, 'analyses', `${id}.raw.txt`)); } catch { /* ignore */ }

    ctx.pushManager?.enqueueDbChange(['papers', 'mappings'], 'delete', { papers: [id] });
  });
}
