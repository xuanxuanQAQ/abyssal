/**
 * IPC handler: search namespace
 *
 * Contract channels: search:semanticScholar, search:openalex, search:arxiv,
 *                    search:paperDetails, search:citations, search:related,
 *                    search:byAuthor, search:googleScholar, search:tavilyScholar,
 *                    search:baiduXueshu
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerSearchHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  const ensureSearch = () => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    return ctx.searchModule;
  };

  typedHandler('search:semanticScholar', logger, async (_e, query, limit?, yearRange?) => {
    const search = ensureSearch();
    return search.searchSemanticScholar(query, {
      limit: limit ?? undefined,
      yearRange: yearRange as { min?: number; max?: number } | undefined,
    });
  });

  typedHandler('search:openAlex', logger, async (_e, concepts, limit?, yearRange?) => {
    const search = ensureSearch();
    return search.searchOpenAlex(concepts, {
      limit: limit ?? undefined,
      yearRange: yearRange as { min?: number; max?: number } | undefined,
    });
  });

  typedHandler('search:arxiv', logger, async (_e, query, limit?, categories?) => {
    const search = ensureSearch();
    return search.searchArxiv(query, {
      limit: limit ?? undefined,
      categories: categories ?? undefined,
    });
  });

  typedHandler('search:paperDetails', logger, async (_e, identifier) => {
    const search = ensureSearch();
    return search.getPaperDetails(identifier);
  });

  typedHandler('search:citations', logger, async (_e, identifier, direction, limit?) => {
    const search = ensureSearch();
    return search.getCitations(identifier, direction, limit ?? undefined);
  });

  typedHandler('search:related', logger, async (_e, identifier, _limit?) => {
    const search = ensureSearch();
    return search.getRelatedPapers(identifier);
  });

  typedHandler('search:byAuthor', logger, async (_e, authorName, limit?) => {
    const search = ensureSearch();
    return search.searchByAuthor(authorName, undefined, limit ?? undefined);
  });

  // ── 中文文献搜索 ──

  typedHandler('search:googleScholar', logger, async (_e, query, limit?, yearRange?) => {
    const search = ensureSearch();
    return search.searchGoogleScholar(query, {
      limit: limit ?? undefined,
      yearRange: yearRange as { min?: number; max?: number } | undefined,
    });
  });

  typedHandler('search:tavilyScholar', logger, async (_e, query, limit?) => {
    const search = ensureSearch();
    return search.searchTavilyScholar(query, { limit: limit ?? undefined });
  });

  typedHandler('search:baiduXueshu', logger, async (_e, query, limit?) => {
    if (!ctx.baiduXueshuSearch) {
      throw new Error('百度学术 search not available (Electron main process only)');
    }
    return ctx.baiduXueshuSearch(query, limit ?? 10);
  });
}
