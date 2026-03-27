/**
 * Bibliography workflow — citation formatting + three-format export.
 *
 * Pipeline:
 * 1. Citation marker scan — regex /@paper_id/ extraction (§3.2 Step 1)
 * 2. Bibliography completeness check (§3.2 Step 2)
 * 3. CSL engine formatting (§3.2 Step 3)
 * 4. Citation marker replacement (§3.2 Step 4)
 * 5. Export file generation — LaTeX+BibTeX / Markdown+BibTeX (§3.3)
 *
 * Per-paper enrichment:
 * - CrossRef + Semantic Scholar metadata enrichment (§2.9)
 * - BibTeX key deterministic generation (§3.3)
 *
 * Idempotency: skips papers where biblio_complete = 1.
 * Can run in parallel with any other workflow (read-only on paper content).
 *
 * See spec: §3
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { WorkflowOptions, WorkflowRunnerContext } from '../workflow-runner';
import type { Logger } from '../../../core/infra/logger';
import type { PaperMetadata } from '../../../core/types/paper';
import { CircuitBreaker, classifyError } from '../error-classifier';
import { createConcurrencyGuard } from '../concurrency-guard';

// ─── Services ───

export interface BibliographyServices {
  dbProxy: {
    queryPapers: (filter: unknown) => Promise<{ items: Array<Record<string, unknown>> }>;
    getPaper: (id: string) => Promise<Record<string, unknown> | null>;
    updatePaper: (id: unknown, fields: unknown) => Promise<void>;
    getArticle?: (id: string) => Promise<Record<string, unknown> | null>;
    getArticleSections?: (articleId: string) => Promise<Array<Record<string, unknown>>>;
  };
  bibliographyService: {
    enrichBibliography: (paper: unknown) => Promise<unknown>;
    checkBiblioCompleteness?: (paper: unknown) => { complete: boolean; missingFields: string[] };
    exportBibtex: (papers: unknown[]) => string;
    scanAndReplace: (markdown: string, paperMap: Map<string, unknown>) => { text: string; citationIds: string[] };
    exportForLatex: (markdown: string, paperMap: Map<string, unknown>) => { tex: string; bib: string };
    exportForPandoc: (markdown: string, paperMap: Map<string, unknown>) => { md: string; bib: string };
    generateBibtexKey?: (metadata: unknown, existingKeys: Set<string>) => string;
    formatBibliography?: (papers: unknown[], format?: string) => string;
  };
  logger: Logger;
  workspacePath: string;
}

// ─── Workflow ───

export function createBibliographyWorkflow(services: BibliographyServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, bibliographyService, logger, workspacePath } = services;
    const breaker = new CircuitBreaker(10);
    const guard = createConcurrencyGuard('bibliography', options.concurrency);

    if (!bibliographyService) {
      logger.warn('Bibliography workflow: BibliographyService not available');
      return;
    }

    // ── Phase 1: Per-paper enrichment ──
    // Query papers needing bibliography work
    let paperIds = options.paperIds;
    if (!paperIds || paperIds.length === 0) {
      const result = await dbProxy.queryPapers({ biblioComplete: false, limit: 1000 });
      paperIds = result.items.map((p) => p['id'] as string);
    }

    runner.setTotal(paperIds.length);

    // Parallel enrichment with concurrency control
    const concurrency = options.concurrency ?? 10;
    let nextIndex = 0;

    const enrichWorker = async () => {
      while (nextIndex < paperIds!.length) {
        if (runner.signal.aborted) break;
        const paperId = paperIds![nextIndex++]!;

        await guard.runWithSlot(async ({ writeExclusive }) => {
          runner.reportProgress({ currentItem: paperId, currentStage: 'enriching' });

          try {
            const paper = await dbProxy.getPaper(paperId);
            if (!paper) {
              runner.reportSkipped(paperId);
              return;
            }

            // Check if already complete
            const biblioComplete = paper['biblioComplete'] ?? paper['biblio_complete'];
            if (biblioComplete === true || biblioComplete === 1) {
              runner.reportSkipped(paperId);
              return;
            }

            // Enrich via CrossRef/Semantic Scholar (§2.9)
            await bibliographyService.enrichBibliography(paper);

            // Update completeness flag
            await writeExclusive(async () => {
              const enrichedPaper = await dbProxy.getPaper(paperId);
              if (!enrichedPaper) return;

              let isComplete = true;
              if (bibliographyService.checkBiblioCompleteness) {
                const check = bibliographyService.checkBiblioCompleteness(enrichedPaper);
                isComplete = check.complete;
              }

              await dbProxy.updatePaper(paperId, {
                biblioComplete: isComplete,
              });
            });

            runner.reportComplete(paperId);
            breaker.recordSuccess();
          } catch (error) {
            runner.reportFailed(paperId, 'bibliography', error as Error);
            breaker.recordFailure(error);
          }
        });
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => enrichWorker()));

    // ── Phase 2: Article citation formatting + export (§3.2) ──
    if (options.articleId && dbProxy.getArticle && dbProxy.getArticleSections) {
      runner.reportProgress({ currentStage: 'formatting_citations' });

      try {
        await formatAndExportArticle(
          options.articleId,
          dbProxy,
          bibliographyService,
          logger,
          workspacePath,
        );
      } catch (err) {
        logger.warn(`Article citation formatting failed: ${(err as Error).message}`);
      }
    }
  };
}

// ─── Article citation formatting + export (§3.2-3.3) ───

async function formatAndExportArticle(
  articleId: string,
  dbProxy: BibliographyServices['dbProxy'],
  bibService: BibliographyServices['bibliographyService'],
  logger: Logger,
  workspacePath: string,
): Promise<void> {
  // Step 1: Scan citation markers [@paper_id] (§3.2 Step 1)
  const sections = await dbProxy.getArticleSections!(articleId);
  const allText = sections.map((s) => (s['content'] as string) ?? '').join('\n\n');

  const citationPattern = /\[@([a-f0-9]{12})\]/g;
  const citedPaperIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(allText)) !== null) {
    citedPaperIds.add(match[1]!);
  }

  if (citedPaperIds.size === 0) {
    logger.info('No citation markers found in article');
    return;
  }

  logger.info(`Found ${citedPaperIds.size} unique citation markers`);

  // Step 2: Completeness check (§3.2 Step 2)
  const paperMap = new Map<string, Record<string, unknown>>();
  const warnings: string[] = [];

  for (const paperId of citedPaperIds) {
    const paper = await dbProxy.getPaper(paperId);
    if (!paper) {
      warnings.push(`Referenced paper ${paperId} not found in database`);
      continue;
    }
    paperMap.set(paperId, paper);

    if (bibService.checkBiblioCompleteness) {
      const check = bibService.checkBiblioCompleteness(paper);
      if (!check.complete) {
        warnings.push(`Paper ${paperId}: missing fields: ${check.missingFields.join(', ')}`);
      }
    }
  }

  if (warnings.length > 0) {
    logger.warn(`Bibliography completeness warnings:\n${warnings.join('\n')}`);
  }

  // Step 3-4: Format + replace (§3.2 Steps 3-4)
  // Handled by scan-replace module which does both inline replacement and bibliography generation

  // Step 5: Export files (§3.3)
  const article = await dbProxy.getArticle!(articleId);
  const slug = (article?.['slug'] as string) ?? articleId;
  const outDir = path.join(workspacePath, 'articles', slug);
  fs.mkdirSync(outDir, { recursive: true });

  // LaTeX + BibTeX export
  try {
    const { tex, bib } = bibService.exportForLatex(allText, paperMap as Map<string, unknown>);
    fs.writeFileSync(path.join(outDir, `${slug}.tex`), tex, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'references.bib'), bib, 'utf-8');
    logger.info(`Exported LaTeX + BibTeX to ${outDir}`);
  } catch (err) {
    logger.warn(`LaTeX export failed: ${(err as Error).message}`);
  }

  // Markdown + BibTeX export (Pandoc format)
  try {
    const { md, bib } = bibService.exportForPandoc(allText, paperMap as Map<string, unknown>);
    fs.writeFileSync(path.join(outDir, `${slug}.md`), md, 'utf-8');
    // BibTeX already written above, but write again if LaTeX export failed
    if (!fs.existsSync(path.join(outDir, 'references.bib'))) {
      fs.writeFileSync(path.join(outDir, 'references.bib'), bib, 'utf-8');
    }
    logger.info(`Exported Markdown + BibTeX to ${outDir}`);
  } catch (err) {
    logger.warn(`Markdown export failed: ${(err as Error).message}`);
  }

  // TODO: Word (.docx) export requires docx library integration
}
