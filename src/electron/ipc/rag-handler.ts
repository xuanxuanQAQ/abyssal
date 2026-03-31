/**
 * IPC handler: rag namespace
 *
 * Contract channels: rag:search, rag:searchWithReport, rag:getWritingContext
 */

import type { RankedChunk } from '../../core/types/chunk';
import type { RAGResult } from '../../shared-types/models';
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

  typedHandler('rag:getWritingContext', logger, async (_e, sectionId) => {
    const rag = ensureRag();

    // Use sectionId as query text for RAG passage retrieval
    const chunks = await rag.searchSemantic(sectionId, 10);

    return {
      relatedSyntheses: [],
      ragPassages: chunks.map(toRAGResult),
      privateKBMatches: [],
      precedingSummary: '',
      followingSectionTitles: [],
    };
  });
}
