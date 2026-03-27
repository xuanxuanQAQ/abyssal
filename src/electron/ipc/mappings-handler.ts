/**
 * IPC handler: mappings namespace
 *
 * Contract channels: db:mappings:getForPaper, db:mappings:getForConcept,
 *   db:mappings:adjudicate, db:mappings:getHeatmapData
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asPaperId, asConceptId } from '../../core/types/common';
import type { ConceptMapping } from '../../shared-types/models';

export function registerMappingsHandlers(ctx: AppContext): void {
  const { logger, dbProxy } = ctx;

  // ── db:mappings:getForPaper ──
  typedHandler('db:mappings:getForPaper', logger, async (_e, paperId) => {
    return await dbProxy.getMappingsByPaper(asPaperId(paperId)) as unknown as ConceptMapping[];
  });

  // ── db:mappings:getForConcept ──
  typedHandler('db:mappings:getForConcept', logger, async (_e, conceptId) => {
    return await dbProxy.getMappingsByConcept(asConceptId(conceptId)) as unknown as ConceptMapping[];
  });

  // ── db:mappings:adjudicate ──
  typedHandler('db:mappings:adjudicate', logger, async () => {
    // TODO: adjudicateMapping DAO not yet implemented
  });

  // ── db:mappings:getHeatmapData ──
  typedHandler('db:mappings:getHeatmapData', logger, async () => {
    const entries = await dbProxy.getConceptMatrix();
    const conceptIds = [...new Set(entries.map((e) => e['conceptId'] as string))];
    const paperIds = [...new Set(entries.map((e) => e['paperId'] as string))];
    const cells = entries.map((e) => ({
      paperId: e['paperId'],
      conceptId: e['conceptId'],
      relation: e['relation'],
      confidence: e['confidence'],
      reviewed: e['reviewed'],
    }));
    return { conceptIds, paperIds, cells } as any;
  });
}
