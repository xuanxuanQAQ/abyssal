/**
 * Diagnostic queries — twelve SQL health checks + rule engine.
 *
 * Each query detects a project health indicator. Results feed the
 * rule engine which produces prioritized RawSuggestions.
 *
 * See spec: §2-3
 */

// Re-export types from shared module
export type { SuggestionType, SuggestionAction, RawSuggestion, DiagnosticData } from './suggestion-types';

import type { DiagnosticData, RawSuggestion } from './suggestion-types';

// ─── Query runners ───

type QueryFn = (sql: string) => Promise<unknown[]>;

/**
 * Run all diagnostic queries with time-slicing.
 *
 * Queries are executed sequentially (better-sqlite3 is sync anyway) with
 * a yield between each query via setImmediate. This prevents blocking
 * the event loop for hundreds of milliseconds in large workspaces,
 * keeping the UI responsive during batch workflow completions.
 */
export async function runDiagnosticQueries(queryFn: QueryFn): Promise<DiagnosticData> {
  // Each query is wrapped in a thunk (lazy function) for sequential time-sliced execution
  const queries: Array<() => Promise<unknown[]>> = [
    // D1: Concept coverage (§2.2)
    () => queryFn(`SELECT c.id AS conceptId, c.name_en AS nameEn, c.maturity,
      COUNT(pcm.paper_id) AS mappedPapers,
      SUM(CASE WHEN pcm.reviewed = 1 THEN 1 ELSE 0 END) AS reviewedPapers
      FROM concepts c LEFT JOIN paper_concept_map pcm ON pcm.concept_id = c.id
      WHERE c.deprecated = 0 GROUP BY c.id`),

    // D2: Unreviewed mappings (§2.3)
    () => queryFn(`SELECT concept_id AS conceptId, COUNT(*) AS total,
      SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END) AS unreviewed
      FROM paper_concept_map GROUP BY concept_id HAVING unreviewed > 0`),

    // D3: Low quality mappings (§2.4)
    () => queryFn(`SELECT concept_id AS conceptId, COUNT(*) AS totalReviewed,
      SUM(CASE WHEN confidence < 0.3 THEN 1 ELSE 0 END) AS lowConfidence
      FROM paper_concept_map WHERE reviewed = 1 GROUP BY concept_id
      HAVING lowConfidence > totalReviewed * 0.3`),

    // D4: Acquire failures (§2.5)
    () => queryFn(`SELECT failure_reason AS failureReason, COUNT(*) AS count
      FROM papers WHERE fulltext_status = 'failed'
      GROUP BY failure_reason ORDER BY count DESC`),

    // D5: Analyze failures (§2.6)
    () => queryFn(`SELECT failure_reason AS failureReason, COUNT(*) AS count
      FROM papers WHERE analysis_status = 'failed' GROUP BY failure_reason`),

    // D6: Synthesis missing (§2.7)
    () => queryFn(`SELECT c.id, c.name_en AS nameEn FROM concepts c
      LEFT JOIN paper_concept_map reviewed_pcm
        ON c.id = reviewed_pcm.concept_id AND reviewed_pcm.reviewed = 1
      WHERE c.deprecated = 0
        AND reviewed_pcm.concept_id IS NULL
        AND (SELECT COUNT(*) FROM paper_concept_map WHERE concept_id = c.id) >= 3`),

    // D7: Writing dependencies (§2.8)
    () => safeQuery(queryFn, `SELECT
      o.id AS outlineId, o.title AS sectionTitle, o.sort_order AS seq,
      je.value AS requiredConceptId
      FROM outlines o, json_each(o.concept_ids) je
      WHERE o.status = 'pending'
        AND o.article_id IN (SELECT id FROM articles WHERE status = 'drafting')`),

    // D8: Concept suggestions (§2.9)
    () => queryFn(`SELECT term, term_normalized AS termNormalized,
      source_paper_count AS sourcePaperCount, reason
      FROM suggested_concepts WHERE status = 'pending'
      AND source_paper_count >= 3 ORDER BY source_paper_count DESC LIMIT 10`),

    // D9: Unstable definitions (§2.10)
    () => queryFn(`SELECT c.id, c.name_en AS nameEn,
      json_array_length(c.history) AS changeCount
      FROM concepts c WHERE c.deprecated = 0
      AND json_array_length(c.history) >= 4`),

    // D10: Maturity upgrades (§2.11)
    () => queryFn(`SELECT c.id, c.name_en AS nameEn, c.maturity,
      COUNT(pcm.paper_id) AS mappedPapers, AVG(pcm.confidence) AS avgConfidence
      FROM concepts c JOIN paper_concept_map pcm ON pcm.concept_id = c.id
      WHERE c.deprecated = 0 AND c.maturity = 'tentative'
      AND pcm.reviewed = 1 AND pcm.confidence >= 0.6
      GROUP BY c.id HAVING mappedPapers >= 5 AND avgConfidence >= 0.65`),

    // D11: Unindexed memos (§2.12)
    () => queryFn(`SELECT COUNT(*) AS count FROM research_memos WHERE indexed = 0`),

    // D12: Concept conflicts (§2.13)
    () => safeQuery(queryFn, `SELECT
      json_extract(pr.metadata, '$.conceptId') AS conceptId,
      c.name_en AS conceptName,
      pr.source_paper_id AS sourcePaperId,
      pr.target_paper_id AS targetPaperId,
      p1.title AS sourceTitle,
      p2.title AS targetTitle
      FROM paper_relations pr
      JOIN papers p1 ON p1.id = pr.source_paper_id
      JOIN papers p2 ON p2.id = pr.target_paper_id
      JOIN concepts c ON c.id = json_extract(pr.metadata, '$.conceptId')
      WHERE pr.edge_type = 'concept_conflict' AND c.deprecated = 0`),
  ];

  // Execute sequentially with event-loop yield between each query.
  // better-sqlite3 is synchronous — Promise.all would block the event loop
  // for the entire batch. Time-slicing keeps UI responsive.
  const results: unknown[][] = [];
  for (const queryThunk of queries) {
    results.push(await queryThunk());
    // Yield to event loop between queries so IPC/render can proceed
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const [
    conceptCoverage, unreviewedMappings, lowQualityMappings,
    acquireFailures, analyzeFailures, synthesisMissing,
    writingDependencies, pendingSuggestions, unstableDefinitions,
    maturityUpgrades, unindexedMemos, conceptConflicts,
  ] = results;

  return {
    conceptCoverage: (conceptCoverage ?? []) as DiagnosticData['conceptCoverage'],
    unreviewedMappings: (unreviewedMappings ?? []) as DiagnosticData['unreviewedMappings'],
    lowQualityMappings: (lowQualityMappings ?? []) as DiagnosticData['lowQualityMappings'],
    acquireFailures: (acquireFailures ?? []) as DiagnosticData['acquireFailures'],
    analyzeFailures: (analyzeFailures ?? []) as DiagnosticData['analyzeFailures'],
    synthesisMissing: (synthesisMissing ?? []) as DiagnosticData['synthesisMissing'],
    writingDependencies: (writingDependencies ?? []) as DiagnosticData['writingDependencies'],
    pendingSuggestions: (pendingSuggestions ?? []) as DiagnosticData['pendingSuggestions'],
    unstableDefinitions: (unstableDefinitions ?? []) as DiagnosticData['unstableDefinitions'],
    maturityUpgrades: (maturityUpgrades ?? []) as DiagnosticData['maturityUpgrades'],
    unindexedMemoCount: ((unindexedMemos as unknown as Array<{ count: number }> ?? [])[0]?.count) ?? 0,
    conceptConflicts: (conceptConflicts ?? []) as DiagnosticData['conceptConflicts'],
  };
}

/**
 * Run a query that may fail (e.g., table doesn't exist yet).
 * Returns empty array on failure instead of throwing.
 */
async function safeQuery(queryFn: QueryFn, sql: string): Promise<unknown[]> {
  try {
    return await queryFn(sql);
  } catch {
    return [];
  }
}

// ─── Rule engine (§3.3) ───

export function evaluateRules(data: DiagnosticData): RawSuggestion[] {
  const suggestions: RawSuggestion[] = [];

  // D1: Concept coverage
  for (const c of data.conceptCoverage) {
    if (c.mappedPapers < 2) {
      suggestions.push({
        type: 'concept_coverage_low',
        priority: 'high',
        title: `Concept "${c.nameEn}" has only ${c.mappedPapers} paper(s)`,
        details: c,
        action: { type: 'workflow', workflowType: 'discover', workflowOptions: { conceptIds: [c.conceptId] } },
        diagnosticSource: 'D1',
      });
    } else if (c.mappedPapers < 5) {
      suggestions.push({
        type: 'concept_coverage_low',
        priority: 'medium',
        title: `Concept "${c.nameEn}" has limited coverage (${c.mappedPapers} papers)`,
        details: c,
        action: { type: 'workflow', workflowType: 'discover', workflowOptions: { conceptIds: [c.conceptId] } },
        diagnosticSource: 'D1',
      });
    }
  }

  // D2: Unreviewed mappings
  for (const m of data.unreviewedMappings) {
    if (m.total === 0) continue;
    const ratio = m.unreviewed / m.total;
    if (ratio > 0.7) {
      suggestions.push({
        type: 'mapping_unreviewed',
        priority: 'high',
        title: `${Math.round(ratio * 100)}% of mappings for a concept are unreviewed (${m.unreviewed}/${m.total})`,
        details: m,
        action: { type: 'navigate', route: `/library?filter=concept:${m.conceptId}&unreviewed=true` },
        diagnosticSource: 'D2',
      });
    } else if (ratio > 0.5) {
      suggestions.push({
        type: 'mapping_unreviewed',
        priority: 'medium',
        title: `${Math.round(ratio * 100)}% of mappings for a concept are unreviewed`,
        details: m,
        action: { type: 'navigate', route: `/library?filter=concept:${m.conceptId}&unreviewed=true` },
        diagnosticSource: 'D2',
      });
    }
  }

  // D3: Low quality mappings
  for (const m of data.lowQualityMappings) {
    suggestions.push({
      type: 'mapping_quality_low',
      priority: 'medium',
      title: `Concept has ${m.lowConfidence} low-confidence mappings after review`,
      details: m,
      action: { type: 'navigate', route: `/framework?focus=${m.conceptId}` },
      diagnosticSource: 'D3',
    });
  }

  // D4: Acquire failures
  const totalAcquireFailures = data.acquireFailures.reduce((sum, f) => sum + f.count, 0);
  if (totalAcquireFailures > 10) {
    suggestions.push({
      type: 'acquire_failures',
      priority: 'high',
      title: `${totalAcquireFailures} papers failed to acquire`,
      details: { failures: data.acquireFailures },
      action: { type: 'workflow', workflowType: 'acquire', workflowOptions: { filter: { fulltext_status: 'failed' } } },
      diagnosticSource: 'D4',
    });
  } else if (totalAcquireFailures >= 5) {
    suggestions.push({
      type: 'acquire_failures',
      priority: 'medium',
      title: `${totalAcquireFailures} papers failed to acquire`,
      details: { failures: data.acquireFailures },
      action: { type: 'workflow', workflowType: 'acquire' },
      diagnosticSource: 'D4',
    });
  }

  // D5: Analyze failures
  const totalAnalyzeFailures = data.analyzeFailures.reduce((sum, f) => sum + f.count, 0);
  if (totalAnalyzeFailures > 3) {
    suggestions.push({
      type: 'analyze_failures',
      priority: totalAnalyzeFailures > 10 ? 'high' : 'medium',
      title: `${totalAnalyzeFailures} papers failed analysis`,
      details: { failures: data.analyzeFailures },
      action: { type: 'workflow', workflowType: 'analyze', workflowOptions: { filter: { analysis_status: 'failed' } } },
      diagnosticSource: 'D5',
    });
  }

  // D6: Synthesis missing
  for (const c of data.synthesisMissing) {
    suggestions.push({
      type: 'synthesis_missing',
      priority: 'medium',
      title: `Concept "${c.nameEn}" has enough mappings but no synthesis`,
      details: c,
      action: { type: 'workflow', workflowType: 'synthesize', workflowOptions: { conceptIds: [c.id] } },
      diagnosticSource: 'D6',
    });
  }

  // D7: Writing dependencies (§2.8)
  for (const dep of data.writingDependencies) {
    suggestions.push({
      type: 'writing_dependency',
      priority: 'high',
      title: `Section "${dep.sectionTitle}" requires synthesis for concept that may be missing`,
      details: dep,
      action: { type: 'workflow', workflowType: 'synthesize', workflowOptions: { conceptIds: [dep.requiredConceptId] } },
      diagnosticSource: 'D7',
    });
  }

  // D8: Concept suggestions (v1.3)
  for (const s of data.pendingSuggestions) {
    suggestions.push({
      type: 'concept_suggestion',
      priority: s.sourcePaperCount >= 5 ? 'high' : 'medium',
      title: `AI found term "${s.term}" in ${s.sourcePaperCount} papers`,
      details: s,
      action: { type: 'navigate', route: `/framework?tab=suggestions&focus=${s.termNormalized ?? s.term.toLowerCase()}` },
      diagnosticSource: 'D8',
    });
  }

  // D9: Unstable definitions (v1.3)
  for (const c of data.unstableDefinitions) {
    suggestions.push({
      type: 'definition_unstable',
      priority: 'medium',
      title: `Concept "${c.nameEn}" changed ${c.changeCount} times`,
      details: c,
      action: { type: 'navigate', route: `/framework?focus=${c.id}&tab=evolution` },
      diagnosticSource: 'D9',
    });
  }

  // D10: Maturity upgrades (v1.3)
  for (const c of data.maturityUpgrades) {
    const targetMaturity = c.maturity === 'tentative' ? 'working' : 'established';
    suggestions.push({
      type: 'maturity_upgrade',
      priority: 'low',
      title: `Consider upgrading "${c.nameEn}" from ${c.maturity} to ${targetMaturity}`,
      details: c,
      action: { type: 'operation', operation: 'updateConceptMaturity', operationArgs: { conceptId: c.id, newMaturity: targetMaturity } },
      diagnosticSource: 'D10',
    });
  }

  // D11: Unindexed memos (v1.3)
  if (data.unindexedMemoCount > 0) {
    suggestions.push({
      type: 'unindexed_memos',
      priority: 'low',
      title: `${data.unindexedMemoCount} memo(s) not indexed for search`,
      details: { count: data.unindexedMemoCount },
      action: { type: 'operation', operation: 'rebuildMemoIndex', operationArgs: {} },
      diagnosticSource: 'D11',
    });
  }

  // D12: Concept conflicts unresolved (§2.13)
  const conflictsByConcept = new Map<string, Array<DiagnosticData['conceptConflicts'][number]>>();
  for (const c of data.conceptConflicts) {
    const existing = conflictsByConcept.get(c.conceptId) ?? [];
    existing.push(c);
    conflictsByConcept.set(c.conceptId, existing);
  }
  for (const [conceptId, conflicts] of conflictsByConcept) {
    suggestions.push({
      type: 'concept_conflict',
      priority: 'medium',
      title: `${conflicts.length} paper pair(s) conflict on concept "${conflicts[0]!.conceptName}" — synthesis may not address it`,
      details: { conceptId, conflicts },
      action: { type: 'workflow', workflowType: 'synthesize', workflowOptions: { conceptIds: [conceptId] } },
      diagnosticSource: 'D12',
    });
  }

  return suggestions;
}
