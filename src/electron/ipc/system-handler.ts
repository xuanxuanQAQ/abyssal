/**
 * IPC handler: system namespace
 *
 * Contract channels: db:discoverRuns:*, db:relations:*,
 *   fs:openPDF, fs:savePDFAnnotations, fs:exportArticle, fs:selectImageFile, fs:importFiles,
 *   app:getConfig, app:updateConfig, app:getProjectInfo, app:globalSearch
 * Plus reader:pageChanged fire-and-forget event.
 *
 * Tags, window, and workspace handlers are in their own files.
 */

import { ipcMain, dialog } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { AppContext } from '../app-context';
import type { GlobalSearchResult } from '../../shared-types/models';
import type { CitationStyle } from '../../shared-types/enums';
import { typedHandler } from './register';
import { asPaperId } from '../../core/types/common';
import type { RelationGraphFilter } from '../../core/database/dao/relations';
import { exportArticle } from './export-handler';
import { insertBibEntries } from './shared/import-bibtex';

export function registerSystemHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── db:discoverRuns ──

  typedHandler('db:discoverRuns:list', logger, async () => {
    return await ctx.dbProxy.listDiscoverRuns() as any;
  });

  // ── db:relations ──

  typedHandler('db:relations:getGraph', logger, async (_e, filter?) => {
    const f = (filter as Record<string, unknown>) ?? {};
    return await ctx.dbProxy.getRelationGraph({
      centerId: f['focusNodeId'] ? asPaperId(f['focusNodeId'] as string) : undefined,
      depth: (f['hopDepth'] as number) ?? 2,
    } as RelationGraphFilter) as any;
  });

  typedHandler('db:relations:getNeighborhood', logger, async (_e, nodeId, depth, _layers?) => {
    return await ctx.dbProxy.getRelationGraph({
      centerId: asPaperId(nodeId),
      depth: depth ?? 2,
    } as RelationGraphFilter) as any;
  });

  // ── fs ──

  typedHandler('fs:openPDF', logger, async (_e, paperId) => {
    const paper = await ctx.dbProxy.getPaper(asPaperId(paperId)) as Record<string, unknown> | null;
    if (!paper) {
      const err = new Error('Paper not found');
      (err as any).code = 'PAPER_NOT_FOUND';
      (err as any).recoverable = false;
      throw err;
    }

    const fulltextPath = paper['fulltextPath'] ?? paper['fulltext_path'];
    if (!fulltextPath || typeof fulltextPath !== 'string') {
      const err = new Error('Paper has no fulltext PDF — run acquire first');
      (err as any).code = 'NO_FULLTEXT';
      (err as any).recoverable = true;
      throw err;
    }

    const pdfPath = path.isAbsolute(fulltextPath)
      ? fulltextPath
      : path.join(ctx.workspaceRoot, fulltextPath);

    if (!existsSync(pdfPath)) {
      const err = new Error(`PDF file missing on disk: ${path.basename(pdfPath)}`);
      (err as any).code = 'FILE_NOT_FOUND';
      (err as any).recoverable = true;
      throw err;
    }

    const data = await fs.readFile(pdfPath);
    return { path: pdfPath, data } as any;
  });

  typedHandler('fs:savePDFAnnotations', logger, async (_e, paperId, annotations) => {
    logger.debug('fs:savePDFAnnotations called (DB-only mode)', {
      paperId,
      count: Array.isArray(annotations) ? annotations.length : 0,
    });
  });

  typedHandler('fs:exportArticle', logger, async (_e, articleId, format, citationStyle: CitationStyle | undefined, draftId?: string) => {
    return await exportArticle(ctx, { articleId, draftId: draftId ?? undefined, format, citationStyle: citationStyle ?? 'APA' });
  });

  typedHandler('fs:selectImageFile', logger, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择图片',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0]!;
    const name = path.basename(filePath);
    return { path: filePath, name };
  });

  typedHandler('fs:importFiles', logger, async (_e, paths) => {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    const pdfDir = path.join(ctx.workspaceRoot, 'pdfs');

    for (const filePath of paths) {
      const ext = path.extname(filePath).toLowerCase();
      try {
        if (ext === '.bib') {
          if (!ctx.bibliographyModule) { errors.push(`${filePath}: Bibliography service not initialized`); continue; }
          const content = await fs.readFile(filePath, 'utf-8');
          const entries = await ctx.bibliographyModule.importBibtex(content);
          const result = await insertBibEntries(ctx.dbProxy, entries);
          imported += result.imported;
          skipped += result.skipped;
          errors.push(...result.errors);
        } else if (ext === '.ris') {
          if (!ctx.bibliographyModule) { errors.push(`${filePath}: Bibliography service not initialized`); continue; }
          const content = await fs.readFile(filePath, 'utf-8');
          const entries = ctx.bibliographyModule.importRis(content);
          const result = await insertBibEntries(ctx.dbProxy, entries);
          imported += result.imported;
          skipped += result.skipped;
          errors.push(...result.errors);
        } else if (ext === '.pdf') {
          const { validatePdf } = await import('../../core/acquire');
          const { generatePaperId } = await import('../../core/search/paper-id');

          const validation = await validatePdf(filePath);
          if (!validation.valid) {
            errors.push(`${path.basename(filePath)}: Invalid PDF (${validation.reason ?? 'unknown'})`);
            continue;
          }

          const baseName = path.basename(filePath, ext);
          const guessedTitle = baseName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
          const paperId = generatePaperId(null, null, guessedTitle, filePath);

          await fs.mkdir(pdfDir, { recursive: true });
          const destPath = path.join(pdfDir, `${paperId}.pdf`);
          if (existsSync(destPath)) {
            skipped++;
            continue;
          }
          const tmpPath = destPath + '.tmp';
          await fs.copyFile(filePath, tmpPath);
          await fs.rename(tmpPath, destPath);

          try {
            await ctx.dbProxy.addPaper({
              id: paperId,
              title: guessedTitle,
              authors: [],
              year: new Date().getFullYear(),
              doi: null, arxivId: null, venue: null, journal: null,
              volume: null, issue: null, pages: null, publisher: null,
              isbn: null, edition: null, editors: null, bookTitle: null,
              series: null, issn: null, pmid: null, pmcid: null,
              url: null, abstract: null, citationCount: null,
              paperType: 'unknown', source: 'manual',
              bibtexKey: null, biblioComplete: false,
            } as any);

            await ctx.dbProxy.updatePaper(paperId as any, {
              fulltextPath: destPath,
              fulltextStatus: 'pending',
              fulltextSource: 'manual',
            } as any);

            imported++;
          } catch (err) {
            const msg = (err as Error).message;
            if (msg.includes('UNIQUE') || msg.includes('duplicate')) skipped++;
            else errors.push(`${baseName}: ${msg}`);
          }
        } else {
          errors.push(`${path.basename(filePath)}: Unsupported format ${ext}`);
        }
      } catch (err) {
        errors.push(`${path.basename(filePath)}: ${(err as Error).message}`);
      }
    }

    if (imported > 0) {
      ctx.pushManager?.enqueueDbChange(['papers'], 'insert');
    }
    logger.info('File import complete', { imported, skipped, errors: errors.length });
    return { imported, skipped, errors };
  }, { timeoutMs: 120_000 });

  // db:notes:getContent and db:notes:saveContent are registered in notes-handler.ts

  // ── app ──

  typedHandler('app:getConfig', logger, async () => ({
    language: 'zh',
    llmProvider: ctx.config.llm.defaultProvider,
    llmModel: ctx.config.llm.defaultModel,
    workspacePath: ctx.workspaceRoot,
  }) as any);

  typedHandler('app:updateConfig', logger, async () => {});

  typedHandler('app:getProjectInfo', logger, async () => {
    try {
      const stats = (await ctx.dbProxy.getStats()) as any as {
        papers: { total: number };
        concepts: { total: number };
      };
      return {
        name: ctx.config.project.name,
        paperCount: stats.papers.total,
        conceptCount: stats.concepts.total,
        lastModified: new Date().toISOString(),
        workspaceRoot: ctx.workspaceRoot,
      } as any;
    } catch {
      return {
        name: ctx.config.project.name,
        paperCount: 0,
        conceptCount: 0,
        lastModified: new Date().toISOString(),
        workspaceRoot: ctx.workspaceRoot,
      } as any;
    }
  });

  typedHandler('app:globalSearch', logger, async (_e, query) => {
    try {
      const q = (query ?? '').trim();
      if (!q) return [];
      const results: GlobalSearchResult[] = [];
      let rank = 0;

      // papers
      const papers = (await ctx.dbProxy.queryPapers({ searchText: q, limit: 10 })) as any as {
        items: Array<Record<string, unknown>>;
      };
      for (const p of papers.items) {
        results.push({
          entityId: String(p['id'] ?? ''),
          entityType: 'paper',
          title: String(p['title'] ?? ''),
          content: ((p['abstract'] as string) ?? '').slice(0, 200),
          rank: rank++,
        });
      }

      // concepts
      try {
        const concepts = (await ctx.dbProxy.getAllConcepts()) as unknown as Array<Record<string, unknown>>;
        const lq = q.toLowerCase();
        for (const c of concepts) {
          const nameZh = String(c['nameZh'] ?? c['name_zh'] ?? '');
          const nameEn = String(c['nameEn'] ?? c['name_en'] ?? '');
          const def = String(c['definition'] ?? '');
          const keywords = (c['searchKeywords'] ?? c['search_keywords'] ?? []) as string[];
          if (
            nameZh.toLowerCase().includes(lq) ||
            nameEn.toLowerCase().includes(lq) ||
            def.toLowerCase().includes(lq) ||
            keywords.some((k) => k.toLowerCase().includes(lq))
          ) {
            results.push({
              entityId: String(c['id'] ?? ''),
              entityType: 'concept',
              title: nameZh || nameEn,
              content: def.slice(0, 200),
              rank: rank++,
            });
          }
        }
      } catch { /* concepts table may not exist yet */ }

      // memos
      try {
        const memos = (await ctx.dbProxy.queryMemos({ searchText: q, limit: 10 })) as unknown as Array<Record<string, unknown>>;
        for (const m of memos) {
          results.push({
            entityId: String(m['id'] ?? ''),
            entityType: 'memo',
            title: (String(m['text'] ?? '')).slice(0, 60),
            content: (String(m['text'] ?? '')).slice(0, 200),
            rank: rank++,
          });
        }
      } catch { /* memos table may not exist yet */ }

      // notes
      try {
        const notes = (await ctx.dbProxy.queryNotes({ searchText: q })) as unknown as Array<Record<string, unknown>>;
        for (const n of notes.slice(0, 10)) {
          results.push({
            entityId: String(n['id'] ?? ''),
            entityType: 'note',
            title: String(n['title'] ?? ''),
            content: String(n['filePath'] ?? n['file_path'] ?? ''),
            rank: rank++,
          });
        }
      } catch { /* notes table may not exist yet */ }

      return results;
    } catch {
      return [];
    }
  }, { timeoutMs: 60_000 });

  // ── Reader page changed event (fire-and-forget) ──

  ipcMain.on(
    'reader:pageChanged',
    (_event: Electron.IpcMainEvent, paperId: unknown, page: unknown) => {
      if (typeof paperId !== 'string' || typeof page !== 'number') return;
      logger.debug('Reader page changed', { paperId, page });
      ctx.dbProxy.getMappingsByPaper(asPaperId(paperId))
        .then((mappings: unknown) => {
          const arr = mappings as Array<Record<string, unknown>>;
          const pageEvidence = arr.filter((m) => m['evidence_page'] === page || m['evidencePage'] === page);
          if (pageEvidence.length > 0 && ctx.pushManager) {
            ctx.pushManager.pushNotification({
              type: 'reader_evidence',
              title: `${pageEvidence.length} concept evidence on this page`,
              message: pageEvidence.map((m) => m['concept_name'] ?? m['conceptName'] ?? m['concept_id']).join(', '),
            });
          }
        })
        .catch(() => { /* non-critical */ });
    },
  );
}
