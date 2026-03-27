/**
 * IPC handler: concepts namespace
 *
 * Contract channels: db:concepts:list, db:concepts:getFramework,
 *   db:concepts:updateFramework, db:concepts:search, db:concepts:create,
 *   db:concepts:updateMaturity, db:concepts:updateDefinition,
 *   db:concepts:updateParent, db:concepts:getHistory, db:concepts:merge,
 *   db:concepts:split, db:concepts:resolveMerge, db:concepts:reassign,
 *   db:concepts:getTimeline, db:concepts:getStats, db:concepts:getMatrix
 *
 * Triggers frameworkState refresh on mutations.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import type { ConceptDefinition } from '../../core/types/concept';
import { asConceptId } from '../../core/types/common';
import type { UpdateConceptFields, ConflictResolution } from '../../core/database/dao/concepts';
import type { Concept } from '../../shared-types/models';

/** Convert backend ConceptDefinition to frontend Concept shape */
function conceptToFrontend(c: ConceptDefinition): Concept {
  return {
    id: c.id,
    name: c.nameEn,
    nameZh: c.nameZh,
    nameEn: c.nameEn,
    description: c.definition,
    parentId: c.parentId,
    level: 0,
    maturity: c.maturity,
    keywords: c.searchKeywords,
    history: [],
  };
}

export function registerConceptsHandlers(ctx: AppContext): void {
  const { logger, dbProxy } = ctx;

  // Helper: refresh framework state after concept mutations
  const afterMutation = async (tables: string[], op: 'insert' | 'update' | 'delete') => {
    await ctx.refreshFrameworkState();
    ctx.pushManager?.enqueueDbChange(tables, op);
  };

  // ── db:concepts:list ──
  typedHandler('db:concepts:list', logger, async () => {
    return ((await dbProxy.getAllConcepts()) as ConceptDefinition[]).map(conceptToFrontend);
  });

  // ── db:concepts:getFramework ──
  typedHandler('db:concepts:getFramework', logger, async () => {
    const all = (await dbProxy.getAllConcepts()) as ConceptDefinition[];
    const rootIds = all.filter((c) => !c.parentId).map((c) => c.id);
    return { concepts: all.map(conceptToFrontend), rootIds };
  });

  // ── db:concepts:updateFramework ──
  typedHandler('db:concepts:updateFramework', logger, async (_e, fw) => {
    const concepts = fw.concepts as unknown as ConceptDefinition[];
    const result = (await dbProxy.syncConcepts(concepts, 'merge')) as any;
    await afterMutation(['concepts', 'paper_concept_map'], 'update');
    return { affected: result['affectedMappingCount'] ?? [] };
  });

  // ── db:concepts:search ──
  typedHandler('db:concepts:search', logger, async (_e, query) => {
    const all = (await dbProxy.getAllConcepts()) as ConceptDefinition[];
    const q = query.toLowerCase();
    return all
      .filter((c) =>
        c.nameEn.toLowerCase().includes(q) ||
        c.nameZh.includes(q) ||
        c.definition.toLowerCase().includes(q),
      )
      .map(conceptToFrontend);
  });

  // ── db:concepts:create ──
  typedHandler('db:concepts:create', logger, async (_e, draft) => {
    const d = draft as unknown as ConceptDefinition;
    await dbProxy.addConcept(d);
    await afterMutation(['concepts'], 'insert');
    const created = (await dbProxy.getConcept(d.id)) as ConceptDefinition | null;
    return created ? conceptToFrontend(created) : null;
  });

  // ── db:concepts:updateMaturity ──
  typedHandler('db:concepts:updateMaturity', logger, async (_e, conceptId, maturity) => {
    await dbProxy.updateConcept(
      asConceptId(conceptId),
      { maturity } as UpdateConceptFields,
    );
    await afterMutation(['concepts'], 'update');
    return { historyEntry: { conceptId, action: 'maturity_change', timestamp: new Date().toISOString() } as any };
  });

  // ── db:concepts:updateDefinition ──
  typedHandler('db:concepts:updateDefinition', logger, async (_e, conceptId, newDef) => {
    const result = (await dbProxy.updateConcept(
      asConceptId(conceptId),
      { definition: newDef } as UpdateConceptFields,
    )) as any;
    await afterMutation(['concepts'], 'update');
    return { updated: true, semanticDrift: result?.['requiresSynthesizeRefresh'] } as any;
  });

  // ── db:concepts:updateParent ──
  typedHandler('db:concepts:updateParent', logger, async (_e, conceptId, newParentId) => {
    await dbProxy.updateConcept(
      asConceptId(conceptId),
      { parentId: newParentId ? asConceptId(newParentId) : null } as UpdateConceptFields,
    );
    await afterMutation(['concepts'], 'update');
    return { updated: true, cycleDetected: false } as any;
  });

  // ── db:concepts:getHistory ──
  typedHandler('db:concepts:getHistory', logger, async (_e, conceptId) => {
    const concept = (await dbProxy.getConcept(asConceptId(conceptId))) as Record<string, unknown> | null;
    return ((concept?.['history'] as unknown[]) ?? []) as any;
  });

  // ── db:concepts:merge ──
  typedHandler('db:concepts:merge', logger, async (_e, retainId, mergeId) => {
    const result = (await dbProxy.mergeConcepts(
      asConceptId(retainId),
      asConceptId(mergeId),
      'max_confidence' as ConflictResolution,
    )) as any;
    await afterMutation(['concepts', 'paper_concept_map'], 'update');
    return { conflicts: result['conflicts'], migratedMappings: result['migratedMappings'] } as any;
  });

  // ── db:concepts:split ──
  typedHandler('db:concepts:split', logger, async (_e, originalId, c1, c2) => {
    const result = (await dbProxy.splitConcept(
      asConceptId(originalId),
      c1 as unknown as ConceptDefinition,
      c2 as unknown as ConceptDefinition,
    )) as any;
    await afterMutation(['concepts', 'paper_concept_map'], 'update');
    return { conceptA: result['conceptA'], conceptB: result['conceptB'], pendingMappings: result['pendingMappings'] } as any;
  });


  // ── db:concepts:getTimeline ──
  typedHandler('db:concepts:getTimeline', logger, async () => {
    // TODO: implement timeline aggregation across concept_history table
    return [];
  });

  // ── db:concepts:getStats ──
  typedHandler('db:concepts:getStats', logger, async (_e, conceptId) => {
    // TODO: implement per-concept statistics (mapping count, paper count, etc.)
    return { conceptId, mappingCount: 0, paperCount: 0 };
  });

  // ── db:concepts:getMatrix ──
  typedHandler('db:concepts:getMatrix', logger, async () => {
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
