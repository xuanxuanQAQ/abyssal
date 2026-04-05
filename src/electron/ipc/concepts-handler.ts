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
import type { Concept, HistoryEntry } from '../../shared-types/models';
import { buildHeatmapMatrix } from './shared/build-heatmap-matrix';
import { createConceptFromDraft } from './shared/create-concept';

function historyEntryToFrontend(entry: ConceptDefinition['history'][number]): HistoryEntry {
  return {
    timestamp: entry.timestamp,
    type: entry.changeType,
    details: {
      summary: entry.oldValueSummary,
      reason: entry.reason,
      ...(entry.metadata ?? {}),
    },
  };
}

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
    history: Array.isArray(c.history) ? c.history.map(historyEntryToFrontend) : [],
  };
}

export function registerConceptsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // Helper: refresh framework state after concept mutations
  const afterMutation = async (tables: string[], op: 'insert' | 'update' | 'delete') => {
    await ctx.refreshFrameworkState();
    ctx.pushManager?.enqueueDbChange(tables, op);
  };

  // ── db:concepts:list ──
  typedHandler('db:concepts:list', logger, async () => {
    return ((await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[]).map(conceptToFrontend);
  });

  // ── db:concepts:getFramework ──
  typedHandler('db:concepts:getFramework', logger, async () => {
    const all = (await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[];
    const rootIds = all.filter((c) => !c.parentId).map((c) => c.id);
    return { concepts: all.map(conceptToFrontend), rootIds };
  });

  // ── db:concepts:updateFramework ──
  typedHandler('db:concepts:updateFramework', logger, async (_e, fw) => {
    const concepts = fw.concepts as unknown as ConceptDefinition[];
    const result = (await ctx.dbProxy.syncConcepts(concepts, 'merge')) as any;
    await afterMutation(['concepts', 'paper_concept_map'], 'update');
    return { affected: result['affectedMappingCount'] ?? [] };
  });

  // ── db:concepts:search ──
  typedHandler('db:concepts:search', logger, async (_e, query) => {
    const all = (await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[];
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
    const conceptId = await createConceptFromDraft(
      ctx.dbProxy,
      draft,
      typeof draft.definition === 'string' ? draft.definition : '',
    );
    await afterMutation(['concepts'], 'insert');
    const created = (await ctx.dbProxy.getConcept(asConceptId(conceptId))) as ConceptDefinition | null;
    return created ? conceptToFrontend(created) : null;
  });

  // ── db:concepts:updateMaturity ──
  typedHandler('db:concepts:updateMaturity', logger, async (_e, conceptId, maturity) => {
    await ctx.dbProxy.updateConcept(
      asConceptId(conceptId),
      { maturity } as UpdateConceptFields,
    );
    await afterMutation(['concepts'], 'update');
    return { historyEntry: { conceptId, action: 'maturity_change', timestamp: new Date().toISOString() } as any };
  });

  // ── db:concepts:updateDefinition ──
  typedHandler('db:concepts:updateDefinition', logger, async (_e, conceptId, newDef) => {
    const result = (await ctx.dbProxy.updateConcept(
      asConceptId(conceptId),
      { definition: newDef } as UpdateConceptFields,
    )) as any;
    await afterMutation(['concepts'], 'update');
    return {
      changeType: result?.['requiresSynthesizeRefresh'] ? 'breaking' : 'additive',
      affectedMappings: result?.['affectedMappings'] ?? 0,
    } as any;
  });

  // ── db:concepts:updateKeywords ──
  typedHandler('db:concepts:updateKeywords', logger, async (_e, conceptId, keywords) => {
    // Input validation
    if (!Array.isArray(keywords)) throw new Error('keywords must be an array');
    if (keywords.length > 50) throw new Error('Too many keywords (max 50)');
    const sanitized = keywords
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter((k) => k.length > 0 && k.length <= 100);

    await ctx.dbProxy.updateConcept(
      asConceptId(conceptId),
      { searchKeywords: sanitized } as UpdateConceptFields,
    );
    await afterMutation(['concepts'], 'update');
    return { updated: true };
  });

  // ── db:concepts:updateParent ──
  typedHandler('db:concepts:updateParent', logger, async (_e, conceptId, newParentId) => {
    await ctx.dbProxy.updateConcept(
      asConceptId(conceptId),
      { parentId: newParentId ? asConceptId(newParentId) : null } as UpdateConceptFields,
    );
    await afterMutation(['concepts'], 'update');
    return { updated: true, cycleDetected: false } as any;
  });

  // ── db:concepts:getHistory ──
  typedHandler('db:concepts:getHistory', logger, async (_e, conceptId) => {
    const concept = (await ctx.dbProxy.getConcept(asConceptId(conceptId))) as Record<string, unknown> | null;
    const history = (concept?.['history'] as ConceptDefinition['history'] | undefined) ?? [];
    return history.map(historyEntryToFrontend) as any;
  });

  // ── db:concepts:merge ──
  typedHandler('db:concepts:merge', logger, async (_e, retainId, mergeId) => {
    const result = (await ctx.dbProxy.mergeConcepts(
      asConceptId(retainId),
      asConceptId(mergeId),
      'max_confidence' as ConflictResolution,
    )) as any;
    await afterMutation(['concepts', 'paper_concept_map'], 'update');
    return { conflicts: result['conflicts'], migratedMappings: result['migratedMappings'] } as any;
  });

  // ── db:concepts:split ──
  typedHandler('db:concepts:split', logger, async (_e, originalId, c1, c2) => {
    const result = (await ctx.dbProxy.splitConcept(
      asConceptId(originalId),
      c1 as unknown as ConceptDefinition,
      c2 as unknown as ConceptDefinition,
    )) as any;
    await afterMutation(['concepts', 'paper_concept_map'], 'update');
    return { conceptA: result['conceptA'], conceptB: result['conceptB'], pendingMappings: result['pendingMappings'] } as any;
  });


  // ── db:concepts:getTimeline ──
  typedHandler('db:concepts:getTimeline', logger, async () => {
    // 聚合所有概念的 history 条目，按时间倒序排列
    const all = (await ctx.dbProxy.getAllConcepts(true)) as ConceptDefinition[];
    const timeline: Array<{
      conceptId: string; conceptName: string;
      timestamp: string; changeType: string; reason: string | null;
      isBreaking: boolean;
    }> = [];

    for (const c of all) {
      if (!Array.isArray(c.history)) continue;
      for (const h of c.history) {
        timeline.push({
          conceptId: c.id,
          conceptName: c.nameEn,
          timestamp: h.timestamp,
          changeType: h.changeType,
          reason: h.reason,
          isBreaking: h.isBreaking,
        });
      }
    }

    timeline.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return timeline.slice(0, 200) as any;
  });

  // ── db:concepts:getStats ──
  typedHandler('db:concepts:getStats', logger, async (_e, conceptId) => {
    const stats = (await ctx.dbProxy.getConceptMappingStats(asConceptId(conceptId))) as any;
    return {
      conceptId,
      mappingCount: stats.mappingCount ?? 0,
      paperCount: stats.paperCount ?? 0,
      avgConfidence: stats.avgConfidence ?? 0,
      relationDistribution: stats.relationDistribution ?? {},
      reviewedCount: stats.reviewedCount ?? 0,
      unreviewedCount: stats.unreviewedCount ?? 0,
    } as any;
  });

  // ── db:concepts:getMatrix ──
  typedHandler('db:concepts:getMatrix', logger, async () => {
    return await buildHeatmapMatrix(ctx.dbProxy) as any;
  });
}
