/**
 * IPC handler: rag namespace
 *
 * Contract channels: rag:search, rag:searchWithReport, rag:getWritingContext
 *
 * TODO: RagModule full implementation pending.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerRagHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('rag:search', logger, async (_e, _query, _filter?) => {
    // TODO: delegate to ragModule.search() when available
    return [];
  });

  typedHandler('rag:searchWithReport', logger, async (_e, _query, _filter?) => {
    // TODO: delegate to ragModule.searchWithReport()
    return { chunks: [], qualityReport: { coverage: 'sufficient', retryCount: 0, gaps: [] } } as any;
  });

  typedHandler('rag:getWritingContext', logger, async (_e, _sectionId) => {
    // TODO: delegate to ragModule.getWritingContext()
    return {
      relatedSyntheses: [],
      ragPassages: [],
      privateKBMatches: [],
      precedingSummary: '',
      followingSectionTitles: [],
    } as any;
  });
}
