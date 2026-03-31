/**
 * IPC handler: mappings namespace
 *
 * Contract channels: db:mappings:getForPaper, db:mappings:getForConcept,
 *   db:mappings:adjudicate, db:mappings:getHeatmapData
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asPaperId, asConceptId } from '../../core/types/common';
import type { RelationType } from '../../core/types/mapping';
import type { ConceptMapping } from '../../shared-types/models';
import { buildHeatmapMatrix } from './shared/build-heatmap-matrix';

export function registerMappingsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── db:mappings:getForPaper ──
  typedHandler('db:mappings:getForPaper', logger, async (_e, paperId) => {
    const rows = await ctx.dbProxy.getMappingsByPaper(asPaperId(paperId));
    return (rows as unknown as Record<string, unknown>[]).map(toFrontendMapping) as unknown as ConceptMapping[];
  });

  // ── db:mappings:getForConcept ──
  typedHandler('db:mappings:getForConcept', logger, async (_e, conceptId) => {
    const rows = await ctx.dbProxy.getMappingsByConcept(asConceptId(conceptId));
    return (rows as unknown as Record<string, unknown>[]).map(toFrontendMapping) as unknown as ConceptMapping[];
  });

  // ── db:mappings:adjudicate ──
  typedHandler('db:mappings:adjudicate', logger, async (_e, mappingId, decision, revised) => {
    // mappingId 格式: "paperId::conceptId" (前端组合的复合 ID)
    const [paperId, conceptId] = (mappingId as string).split('::');
    if (!paperId || !conceptId) {
      throw new Error(`Invalid mappingId format: ${mappingId}. Expected "paperId::conceptId".`);
    }

    const revisedObj = revised as Record<string, unknown> | undefined;
    const revisions = revisedObj
      ? {
          ...(revisedObj['relationType'] != null ? { relation: revisedObj['relationType'] as RelationType } : {}),
          ...(revisedObj['confidence'] != null ? { confidence: revisedObj['confidence'] as number } : {}),
          ...(revisedObj['note'] != null ? { note: revisedObj['note'] as string } : {}),
        }
      : undefined;

    const changes = await ctx.dbProxy.adjudicateMapping(
      asPaperId(paperId),
      asConceptId(conceptId),
      decision as 'accept' | 'reject' | 'revise',
      revisions,
    );

    if (changes === 0) {
      logger.warn('[mappings:adjudicate] No matching mapping found', { paperId, conceptId, decision });
    }

    ctx.pushManager?.enqueueDbChange(['paper_concept_map'], 'update');
  });

  // ── db:mappings:getHeatmapData ──
  typedHandler('db:mappings:getHeatmapData', logger, async () => {
    return await buildHeatmapMatrix(ctx.dbProxy) as any;
  });
}

/**
 * Convert a backend mapping row to the frontend ConceptMapping shape.
 * - Adds composite `id` field ("paperId::conceptId")
 * - Maps `decisionStatus` → `adjudicationStatus`
 */
function toFrontendMapping(row: Record<string, unknown>): Record<string, unknown> {
  const paperId = row['paperId'] as string;
  const conceptId = row['conceptId'] as string;
  return {
    ...row,
    id: `${paperId}::${conceptId}`,
    adjudicationStatus: row['decisionStatus'] ?? 'pending',
  };
}
