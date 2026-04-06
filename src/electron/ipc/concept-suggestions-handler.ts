/**
 * IPC handler: concept-suggestions namespace
 *
 * Contract channels: db:suggestedConcepts:list, db:suggestedConcepts:accept,
 *                    db:suggestedConcepts:dismiss, db:suggestedConcepts:restore,
 *                    db:suggestedConcepts:getStats
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asConceptId, asSuggestionId } from '../../core/types/common';
import type { ConceptDefinition } from '../../core/types/concept';
import type { SuggestedConcept as SharedSuggestedConcept } from '../../shared-types/models';
import { findConceptFrontendById } from './shared/concept-frontend';

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

async function mapSuggestedConcept(
  ctx: AppContext,
  record: Record<string, unknown>,
): Promise<SharedSuggestedConcept> {
  const closestExistingConceptId = (record['closestExistingConceptId'] ?? record['closest_existing_concept_id']) as string | null | undefined;
  const closestExisting = closestExistingConceptId
    ? await ctx.dbProxy.getConcept(closestExistingConceptId as import('../../core/types/common').ConceptId) as Record<string, unknown> | null
    : null;

  return {
    id: String(record['id'] ?? ''),
    term: String(record['term'] ?? ''),
    termNormalized: String(record['termNormalized'] ?? record['term_normalized'] ?? ''),
    frequency: Number(record['frequency'] ?? 0),
    sourcePaperIds: parseStringArray(record['sourcePaperIds'] ?? record['source_paper_ids']),
    sourcePaperCount: Number(record['sourcePaperCount'] ?? record['source_paper_count'] ?? 0),
    closestExisting: closestExistingConceptId && closestExisting
      ? {
        conceptId: closestExistingConceptId,
        conceptName: String(closestExisting['nameEn'] ?? closestExisting['name_en'] ?? closestExisting['nameZh'] ?? closestExisting['name_zh'] ?? closestExistingConceptId),
        maturity: String(closestExisting['maturity'] ?? 'tentative') as SharedSuggestedConcept['closestExisting'] extends infer T
          ? T extends { maturity: infer M }
            ? M
            : never
          : never,
        similarity: (record['closestExistingConceptSimilarity'] ?? record['closest_existing_concept_similarity'] ?? null) as string | null,
      }
      : null,
    reason: String(record['reason'] ?? ''),
    suggestedDefinition: (record['suggestedDefinition'] ?? record['suggested_definition'] ?? null) as string | null,
    suggestedKeywords: parseStringArray(record['suggestedKeywords'] ?? record['suggested_keywords']),
    status: String(record['status'] ?? 'pending') as SharedSuggestedConcept['status'],
    adoptedConceptId: (record['adoptedConceptId'] ?? record['adopted_concept_id'] ?? null) as string | null,
    createdAt: String(record['createdAt'] ?? record['created_at'] ?? ''),
    updatedAt: String(record['updatedAt'] ?? record['updated_at'] ?? ''),
  };
}

function mapConceptDraftToOverrides(draft: Record<string, unknown> | null | undefined): Partial<ConceptDefinition> | undefined {
  if (!draft) return undefined;

  const searchKeywords = Array.isArray(draft['keywords'])
    ? draft['keywords'].filter((keyword): keyword is string => typeof keyword === 'string' && keyword.trim().length > 0)
    : undefined;

  const overrides: Partial<ConceptDefinition> = {};
  if (typeof draft['nameZh'] === 'string') {
    overrides.nameZh = draft['nameZh'].trim();
  }
  if (typeof draft['nameEn'] === 'string') {
    overrides.nameEn = draft['nameEn'].trim();
  }
  if (typeof draft['definition'] === 'string') {
    overrides.definition = draft['definition'].trim();
  }
  if (searchKeywords) {
    overrides.searchKeywords = searchKeywords;
  }
  const parentId = typeof draft['parentId'] === 'string' ? asConceptId(draft['parentId']) : null;
  overrides.parentId = parentId;

  return overrides;
}

export function registerConceptSuggestionsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('db:suggestedConcepts:list', logger, async () => {
    const suggestions = await ctx.dbProxy.getSuggestedConcepts() as unknown as Array<Record<string, unknown>>;
    return await Promise.all(suggestions.map((suggestion) => mapSuggestedConcept(ctx, suggestion)));
  });

  typedHandler('db:suggestedConcepts:accept', logger, async (_e, suggestedId, draft) => {
    const overrides = mapConceptDraftToOverrides(draft as unknown as Record<string, unknown> | undefined);
    const conceptId = (await ctx.dbProxy.adoptSuggestedConcept(
      asSuggestionId(Number(suggestedId)),
      overrides,
    )) as string;
    await ctx.refreshFrameworkState();
    ctx.pushManager?.enqueueDbChange(['concepts', 'suggested_concepts'], 'insert');
    return findConceptFrontendById(
      (await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[],
      conceptId,
    ) as any;
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
