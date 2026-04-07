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
import { asConceptId, asPaperId } from '../../core/types/common';
import type { UpdateConceptFields, ConflictResolution } from '../../core/database/dao/concepts';
import type { ChangeImpactReport, ConceptHealthScore, PaperAnalysisBase } from '../../shared-types/models';
import type { PaperId } from '../../core/types/common';
import { buildHeatmapMatrix } from './shared/build-heatmap-matrix';
import { createConceptFromDraft } from './shared/create-concept';
import { mapConceptsToFrontend, findConceptFrontendById, historyEntryToFrontend } from './shared/concept-frontend';

export function registerConceptsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // Helper: refresh framework state after concept mutations
  const afterMutation = async (tables: string[], op: 'insert' | 'update' | 'delete') => {
    await ctx.refreshFrameworkState();
    ctx.pushManager?.enqueueDbChange(tables, op);
  };

  // ── db:concepts:list ──
  typedHandler('db:concepts:list', logger, async () => {
    return mapConceptsToFrontend((await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[]);
  });

  // ── db:concepts:getFramework ──
  typedHandler('db:concepts:getFramework', logger, async () => {
    const all = (await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[];
    const rootIds = all.filter((c) => !c.parentId).map((c) => c.id);
    return { concepts: mapConceptsToFrontend(all), rootIds };
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
    return mapConceptsToFrontend(all
      .filter((c) =>
        c.nameEn.toLowerCase().includes(q) ||
        c.nameZh.includes(q) ||
        c.definition.toLowerCase().includes(q),
      ));
  });

  // ── db:concepts:create ──
  typedHandler('db:concepts:create', logger, async (_e, draft) => {
    const conceptId = await createConceptFromDraft(
      ctx.dbProxy,
      draft,
      typeof draft.definition === 'string' ? draft.definition : '',
    );
    await afterMutation(['concepts'], 'insert');
    return findConceptFrontendById(
      (await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[],
      asConceptId(conceptId),
    );
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
  typedHandler('db:concepts:merge', logger, async (_e, retainId, mergeId, resolutions) => {
    // 从前端 MergeConflictResolution[] 推断全局冲突解决策略
    let strategy: ConflictResolution = 'max_confidence';
    if (Array.isArray(resolutions) && resolutions.length > 0) {
      const actions = (resolutions as Array<{ action: string }>).map((r) => r.action);
      const unique = new Set(actions);
      if (unique.size === 1) {
        const action = actions[0]!;
        if (action === 'keep_retain') strategy = 'keep';
        else if (action === 'keep_merge') strategy = 'merge';
        // 'merge_confidence' → 'max_confidence' (default)
      }
      // 混合策略时保持 max_confidence 作为安全默认
    }

    const result = (await ctx.dbProxy.mergeConcepts(
      asConceptId(retainId),
      asConceptId(mergeId),
      strategy,
    )) as any;
    await afterMutation(['concepts', 'paper_concept_map'], 'update');
    return { conflicts: result['conflicts'], migratedMappings: result['migratedMappings'] } as any;
  });

  // ── db:concepts:split ──
  typedHandler('db:concepts:split', logger, async (_e, originalId, c1, c2, assignments) => {
    const result = (await ctx.dbProxy.splitConcept(
      asConceptId(originalId),
      c1 as unknown as ConceptDefinition,
      c2 as unknown as ConceptDefinition,
    )) as any;

    const conceptAId = asConceptId(result['conceptA'] as string);
    const conceptBId = asConceptId(result['conceptB'] as string);
    const pendingMappings = (result['pendingMappings'] ?? []) as Array<{ id: string; paperId: string }>;

    // 将前端 'a1'/'a2'/'both' 映射解析为实际概念 ID 并完成拆分
    if (Array.isArray(assignments) && assignments.length > 0) {
      const mappingById = new Map(pendingMappings.map((m) => [m.id, m]));
      const splitAssignments: Array<{ paperId: string; targetConceptId: string }> = [];
      const bothPapers: Array<{ paperId: string }> = [];

      for (const a of assignments as Array<{ mappingId: string; targetConceptId: string }>) {
        const mapping = mappingById.get(a.mappingId);
        if (!mapping) continue;

        if (a.targetConceptId === 'a2') {
          splitAssignments.push({ paperId: mapping.paperId, targetConceptId: conceptBId });
        } else {
          // 'a1' 和 'both' 都先分配给 conceptA
          splitAssignments.push({ paperId: mapping.paperId, targetConceptId: conceptAId });
          if (a.targetConceptId === 'both') {
            bothPapers.push({ paperId: mapping.paperId });
          }
        }
      }

      // completeSplit: 迁移映射 + 废弃原概念
      await ctx.dbProxy.completeSplit(asConceptId(originalId), splitAssignments as any);

      // 'both' 的论文需要额外复制一份映射到 conceptB
      for (const bp of bothPapers) {
        const orig = pendingMappings.find((m) => m.paperId === bp.paperId) as any;
        if (orig) {
          await ctx.dbProxy.mapPaperConcept({
            paperId: bp.paperId,
            conceptId: conceptBId,
            relation: orig.relation ?? 'supports',
            confidence: orig.confidence ?? 0.5,
            evidence: orig.evidence ?? null,
            annotationId: null,
            reviewed: false,
            reviewedAt: null,
          } as any);
        }
      }
    }

    await afterMutation(['concepts', 'paper_concept_map'], 'update');

    // 返回前端友好的结果
    const allConcepts = (await ctx.dbProxy.getAllConcepts()) as ConceptDefinition[];
    return {
      concept1: findConceptFrontendById(allConcepts, conceptAId),
      concept2: findConceptFrontendById(allConcepts, conceptBId),
    } as any;
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

  // ── db:concepts:previewImpact ──
  typedHandler('db:concepts:previewImpact', logger, async (_e, conceptId) => {
    return await ctx.dbProxy.previewConceptChangeImpact(asConceptId(conceptId)) as ChangeImpactReport;
  });

  // ── db:concepts:getHealth ──
  typedHandler('db:concepts:getHealth', logger, async (_e, conceptId) => {
    return await ctx.dbProxy.computeConceptHealth(asConceptId(conceptId)) as ConceptHealthScore;
  });

  // ── db:concepts:getKeywordCandidates ──
  typedHandler('db:concepts:getKeywordCandidates', logger, async (_e, conceptId) => {
    const rows = await ctx.dbProxy.getKeywordCandidates(asConceptId(conceptId));
    // KeywordCandidateRow.id is number, frontend KeywordCandidate.id is string
    return rows.map((r) => ({ ...r, id: String(r.id) })) as unknown as import('../../shared-types/models').KeywordCandidate[];
  });

  // ── db:concepts:acceptKeyword ──
  typedHandler('db:concepts:acceptKeyword', logger, async (_e, candidateId) => {
    const term = await ctx.dbProxy.acceptKeywordCandidate(candidateId);
    await afterMutation(['concepts', 'keyword_candidates'], 'update');
    return { term };
  });

  // ── db:concepts:rejectKeyword ──
  typedHandler('db:concepts:rejectKeyword', logger, async (_e, candidateId) => {
    await ctx.dbProxy.rejectKeywordCandidate(candidateId);
    return { ok: true };
  });

  // ── db:analysisBase:get ──
  typedHandler('db:analysisBase:get', logger, async (_e, paperId) => {
    return await ctx.dbProxy.getAnalysisBase(paperId as PaperId) as PaperAnalysisBase | null;
  });

  // ── db:analysisBase:has ──
  typedHandler('db:analysisBase:has', logger, async (_e, paperId) => {
    return await ctx.dbProxy.hasAnalysisBase(paperId as PaperId) as boolean;
  });
}
