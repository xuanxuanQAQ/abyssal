/**
 * IPC handler: concept-suggestions namespace
 *
 * Contract channels: db:suggestedConcepts:list, db:suggestedConcepts:accept,
 *                    db:suggestedConcepts:dismiss, db:suggestedConcepts:restore,
 *                    db:suggestedConcepts:getStats
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asSuggestionId } from '../../core/types/common';
import type { ConceptDefinition } from '../../core/types/concept';

export function registerConceptSuggestionsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('db:suggestedConcepts:list', logger, async () => {
    return await ctx.dbProxy.getSuggestedConcepts() as any;
  });

  typedHandler('db:suggestedConcepts:accept', logger, async (_e, suggestedId, draft) => {
    const overrides = draft ? (draft as Partial<ConceptDefinition>) : undefined;
    const conceptId = (await ctx.dbProxy.adoptSuggestedConcept(
      asSuggestionId(Number(suggestedId)),
      overrides,
    )) as string;
    await ctx.refreshFrameworkState();
    ctx.pushManager?.enqueueDbChange(['concepts', 'suggested_concepts'], 'insert');
    const created = await ctx.dbProxy.getConcept(conceptId as unknown as import('../../core/types/common').ConceptId);
    return created ?? null as any;
  });

  typedHandler('db:suggestedConcepts:dismiss', logger, async (_e, suggestedId) => {
    await ctx.dbProxy.dismissSuggestedConcept(asSuggestionId(Number(suggestedId)));
    ctx.pushManager?.enqueueDbChange(['suggested_concepts'], 'update');
  });

  typedHandler('db:suggestedConcepts:restore', logger, async (_e, suggestedId) => {
    await ctx.dbProxy.restoreSuggestedConcept(asSuggestionId(Number(suggestedId)));
    ctx.pushManager?.enqueueDbChange(['suggested_concepts'], 'update');
  });

  typedHandler('db:suggestedConcepts:getStats', logger, async () => {
    return (await ctx.dbProxy.getSuggestedConceptsStats()) as any;
  });
}
