/**
 * IPC handler: search namespace
 *
 * Contract channels: search:semanticScholar, search:openalex, search:arxiv,
 *                    search:paperDetails, search:citations, search:related,
 *                    search:byAuthor
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerSearchHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('search:semanticScholar', logger, async (_e, _query, _limit?, _yearRange?) => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    // TODO: delegate to searchModule.searchSemanticScholar when fully wired
    return [];
  });

  typedHandler('search:openalex', logger, async (_e, _concepts, _limit?, _yearRange?) => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    return [];
  });

  typedHandler('search:arxiv', logger, async (_e, _query, _limit?, _categories?) => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    return [];
  });

  typedHandler('search:paperDetails', logger, async (_e, _identifier) => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    return null;
  });

  typedHandler('search:citations', logger, async (_e, _identifier, _direction, _limit?) => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    return [];
  });

  typedHandler('search:related', logger, async (_e, _identifier, _limit?) => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    return [];
  });

  typedHandler('search:byAuthor', logger, async (_e, _authorName, _limit?) => {
    if (!ctx.searchModule) throw new Error('Search module not initialized');
    return [];
  });
}
