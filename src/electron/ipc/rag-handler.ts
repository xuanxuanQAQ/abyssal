/**
 * IPC handler: rag namespace
 *
 * Contract channels: rag:search, rag:searchWithReport, rag:getWritingContext
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RankedChunk } from '../../core/types/chunk';
import type { ConceptId, PaperId } from '../../core/types/common';
import {
  buildSectionContinuityContext,
  parseArticleDocument,
} from '../../shared/writing/documentOutline';
import type { RAGResult, WritingContextRequest } from '../../shared-types/models';
import type { AppContext } from '../app-context';
import { typedHandler } from './register';

/** Map core RankedChunk to shared-types RAGResult for IPC transport. */
function toRAGResult(c: RankedChunk): RAGResult {
  return {
    chunkId: c.chunkId,
    paperId: c.paperId ?? '',
    paperTitle: c.displayTitle ?? '',
    text: c.text,
    score: c.score,
    page: c.pageStart ?? 0,
    retrievalPath: c.originPath as RAGResult['retrievalPath'],
    sectionTitle: c.sectionTitle ?? undefined,
    sectionType: c.sectionType ?? undefined,
    contextBefore: c.contextBefore ?? undefined,
    contextAfter: c.contextAfter ?? undefined,
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function uniqueStrings(items: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function readSynthesisDrafts(workspaceRoot: string, conceptIds: string[]): Array<{ conceptId: string; text: string; sourceIds: string[] }> {
  const draftsDir = path.join(workspaceRoot, 'drafts');
  const fragments: Array<{ conceptId: string; text: string; sourceIds: string[] }> = [];

  for (const conceptId of conceptIds) {
    const draftPath = path.join(draftsDir, `${conceptId}.md`);
    if (!fs.existsSync(draftPath)) continue;

    try {
      const text = fs.readFileSync(draftPath, 'utf-8').trim();
      if (!text) continue;
      fragments.push({
        conceptId,
        text: truncateText(text, 1500),
        sourceIds: [conceptId],
      });
    } catch {
      // Best effort: skip unreadable drafts.
    }
  }

  return fragments;
}

export function registerRagHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  const ensureRag = () => {
    if (!ctx.ragModule) throw new Error('RAG module not initialized');
    return ctx.ragModule;
  };

  typedHandler('rag:search', logger, async (_e, query, filter?) => {
    const rag = ensureRag();
    const chunks = await rag.searchSemantic(
      query,
      filter?.maxResults ?? 10,
      {
        paperIds: filter?.paperIds as any,
      },
    );
    return chunks.map(toRAGResult);
  });

  typedHandler('rag:searchWithReport', logger, async (_e, query, filter?) => {
    const rag = ensureRag();
    const result = await rag.retrieve({
      queryText: query,
      taskType: 'ad_hoc',
      conceptIds: (filter?.conceptIds ?? []) as any,
      paperIds: (filter?.paperIds ?? []) as any,
      sectionTypeFilter: null,
      sourceFilter: null,
      budgetMode: 'broad',
      maxTokens: 4000,
      modelContextWindow: 128000,
      enableCorrectiveRag: false,
      relatedMemoIds: [],
      topK: filter?.maxResults ?? undefined,
    });
    return {
      chunks: result.chunks.map(toRAGResult),
      qualityReport: {
        coverage: result.qualityReport.coverage,
        retryCount: result.qualityReport.retryCount,
        gaps: result.qualityReport.gaps,
      },
    };
  });

  typedHandler('rag:getWritingContext', logger, async (_e, requestArg) => {
    const requestPreview = typeof requestArg === 'string'
      ? requestArg.slice(0, 500)
      : JSON.stringify(requestArg ?? {}).slice(0, 500);
    logger.debug('[rag:getWritingContext] request', { requestPreview });
    const rag = ctx.ragModule; // nullable — RAG passages gracefully empty when unavailable

    const request: WritingContextRequest = typeof requestArg === 'string'
      ? { sectionId: requestArg }
      : requestArg;

    const sectionId = request.sectionId ?? '';
    let queryText = '';
    let conceptIds: ConceptId[] = [];
    let paperIds: PaperId[] = [];
    let precedingSummary = '';
    let followingSectionTitles: string[] = [];

    const liveDocument = request.documentJson
      ? parseArticleDocument(request.documentJson)
      : null;

    if (request.draftId) {
      const draft = await ctx.dbProxy.getDraft(request.draftId as any);
      const articleId = request.articleId ?? draft?.articleId;
      const article = articleId ? await ctx.dbProxy.getArticle(articleId as any) : null;
      const sections = draft ? await ctx.dbProxy.getDraftSections(request.draftId as any) : [];
      const currentSectionIndex = sectionId ? sections.findIndex((section) => section.sectionId === sectionId) : -1;
      const currentSection = currentSectionIndex >= 0 ? sections[currentSectionIndex] : null;
      const draftDocument = draft ? await ctx.dbProxy.getDraftDocument(request.draftId as any) : null;
      const continuity = (liveDocument || draftDocument)
        ? buildSectionContinuityContext(
            liveDocument ?? parseArticleDocument(draftDocument?.documentJson),
            sectionId,
          )
        : null;

      precedingSummary = continuity?.precedingSummary ?? '';
      followingSectionTitles = continuity?.followingSectionTitles ?? [];

      conceptIds = uniqueStrings(currentSection?.conceptIds ?? []) as ConceptId[];
      paperIds = uniqueStrings(currentSection?.paperIds ?? []) as PaperId[];
      queryText = uniqueStrings([
        continuity?.section?.title,
        currentSection?.title,
        currentSection?.writingInstruction,
        draft?.title,
        article?.title,
        ...conceptIds,
      ]).join(' ; ') || sectionId || draft?.title || article?.title || 'writing context';
    } else {
      const entry = await ctx.dbProxy.getOutlineEntry(sectionId as any);
      const articleId = request.articleId ?? (entry as any)?.articleId as string | undefined;
      const article = articleId ? await ctx.dbProxy.getArticle(articleId as any) : null;
      const outline = articleId ? await ctx.dbProxy.getOutline(articleId as any) : [];
      const continuity = liveDocument
        ? buildSectionContinuityContext(liveDocument, sectionId)
        : null;

      const sortOrder = ((entry as any)?.sortOrder as number | undefined) ?? 0;
      const sortedOutline = [...(outline as Array<any>)].sort((a, b) => ((a?.sortOrder ?? 0) as number) - ((b?.sortOrder ?? 0) as number));
      followingSectionTitles = continuity?.followingSectionTitles ?? sortedOutline
        .filter((s) => ((s?.sortOrder ?? 0) as number) > sortOrder)
        .slice(0, 5)
        .map((s) => (s?.title as string) ?? '')
        .filter((t) => t.length > 0);

      const precedingSection = continuity?.precedingSummary
        ? null
        : [...sortedOutline]
            .reverse()
            .find((s) => ((s?.sortOrder ?? 0) as number) < sortOrder);

      if (continuity?.precedingSummary) {
        precedingSummary = continuity.precedingSummary;
      } else if (precedingSection?.id) {
        const drafts = await ctx.dbProxy.getSectionDrafts(precedingSection.id as any);
        const latestDraft = [...(drafts as Array<any>)].sort((a, b) => ((b?.version ?? 0) as number) - ((a?.version ?? 0) as number))[0];
        const title = (precedingSection.title as string) ?? '上一节';
        const content = typeof latestDraft?.content === 'string' ? latestDraft.content : '';
        if (content.length > 0) {
          precedingSummary = `${title}: ${truncateText(content.replace(/\s+/g, ' ').trim(), 240)}`;
        }
      }

      conceptIds = uniqueStrings(((entry as any)?.conceptIds as string[] | undefined) ?? []) as ConceptId[];
      paperIds = uniqueStrings(((entry as any)?.paperIds as string[] | undefined) ?? []) as PaperId[];
      queryText = uniqueStrings([
        continuity?.section?.title,
        (entry as any)?.title as string | undefined,
        (entry as any)?.coreArgument as string | undefined,
        (entry as any)?.writingInstruction as string | undefined,
        (article as any)?.title as string | undefined,
        ...conceptIds,
      ]).join(' ; ') || sectionId;
    }

    let chunks: RankedChunk[] = [];
    let ragStatus: 'ok' | 'unavailable' | 'error' = rag ? 'ok' : 'unavailable';
    let ragStatusDetail: string | undefined;
    if (rag) {
      try {
        const retrieval = await rag.retrieve({
          queryText,
          taskType: 'article',
          conceptIds,
          paperIds,
          sectionTypeFilter: null,
          sourceFilter: null,
          budgetMode: 'focused',
          maxTokens: 4000,
          modelContextWindow: 128000,
          enableCorrectiveRag: false,
          relatedMemoIds: [],
          topK: 10,
        });
        chunks = retrieval.chunks;
      } catch (retrieveErr) {
        // Fallback to semantic search if retrieve path is unavailable.
        try {
          chunks = await rag.searchSemantic(queryText, 10, { paperIds: paperIds.length > 0 ? paperIds : undefined } as any);
        } catch (searchErr) {
          ragStatus = 'error';
          ragStatusDetail = (searchErr as Error).message ?? String(searchErr);
          logger.warn('[rag:getWritingContext] RAG retrieval failed', { error: ragStatusDetail });
        }
      }
    }

    const relatedSyntheses = readSynthesisDrafts(ctx.workspaceRoot, conceptIds);

    const noteMatchesRaw = await ctx.dbProxy.queryNotes({ searchText: queryText, limit: 5 } as any);
    const privateKBMatches = (noteMatchesRaw as Array<any>).map((note) => ({
      docId: (note?.id as string) ?? '',
      text: truncateText(((note?.title as string) ?? '').trim(), 160),
      score: 0.5,
    })).filter((m) => m.docId.length > 0 && m.text.length > 0);

    return {
      relatedSyntheses,
      ragPassages: chunks.map(toRAGResult),
      privateKBMatches,
      precedingSummary,
      followingSectionTitles,
      ragStatus,
      ...(ragStatusDetail ? { ragStatusDetail } : {}),
    };
  });
}
