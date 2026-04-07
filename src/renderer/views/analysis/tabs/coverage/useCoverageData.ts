/**
 * useCoverageData -- Derives coverage statistics from heatmap, paper counts,
 * concept framework data, and writing citation data.
 *
 * Concept score per section 11.3:
 *   synthesized >= 3  -> 1.0
 *   synthesized >= 1  -> 0.7
 *   analyzed >= 1     -> 0.4
 *   acquired >= 1     -> 0.2
 *   else              -> 0.0
 *
 * completeness = avg(concept_scores) * 100
 *
 * "Synthesized" = paper is analyzed + adjudicated (accepted/revised) + cited in writing.
 */

import { useMemo } from 'react';
import { useHeatmapData } from '../../../../core/ipc/hooks/useMappings';
import { usePaperList } from '../../../../core/ipc/hooks/usePapers';
import { useConceptFramework } from '../../../../core/ipc/hooks/useConcepts';
import { useAllCitedPaperIds } from '../../../../core/ipc/hooks/useArticles';
import type { ConceptFramework, Paper, HeatmapMatrix } from '../../../../../shared-types/models';

export interface ConceptCoverage {
  conceptId: string;
  conceptName: string;
  parentId: string | null;
  synthesized: number;
  analyzed: number;
  acquired: number;
  pending: number;
  excluded: number;
  total: number;
  score: number; // 0.0 - 1.0
}

export interface CoverageData {
  completeness: number; // 0-100
  concepts: ConceptCoverage[];
  isLoading: boolean;
}

interface CoverageComputationInput {
  heatmap: HeatmapMatrix;
  papers: Paper[];
  framework: ConceptFramework;
  citedPaperIds?: string[] | undefined;
}

function computeConceptScore(coverage: ConceptCoverage): number {
  if (coverage.synthesized >= 3) return 1.0;
  if (coverage.synthesized >= 1) return 0.7;
  if (coverage.analyzed >= 1) return 0.4;
  if (coverage.acquired >= 1) return 0.2;
  return 0.0;
}

/**
 * Aggregate child concept scores into parents (immutable).
 * Uses: parent score = max(own score, avg(children scores)).
 * Includes cycle detection to prevent infinite recursion.
 */
function aggregateTreeScores(concepts: ConceptCoverage[]): ConceptCoverage[] {
  const byId = new Map(concepts.map((c) => [c.conceptId, c]));
  const childrenOf = new Map<string, ConceptCoverage[]>();

  for (const c of concepts) {
    if (c.parentId && byId.has(c.parentId)) {
      const siblings = childrenOf.get(c.parentId);
      if (siblings) {
        siblings.push(c);
      } else {
        childrenOf.set(c.parentId, [c]);
      }
    }
  }

  // Immutable score map — never mutate ConceptCoverage during recursion
  const resolvedScores = new Map<string, number>();
  const visiting = new Set<string>(); // cycle detection

  function resolveScore(c: ConceptCoverage): number {
    const cached = resolvedScores.get(c.conceptId);
    if (cached !== undefined) return cached;

    // Cycle detection: if we're already visiting this node, return own score
    if (visiting.has(c.conceptId)) return c.score;
    visiting.add(c.conceptId);

    const children = childrenOf.get(c.conceptId);
    let finalScore = c.score;
    if (children && children.length > 0) {
      const childScores = children.map(resolveScore);
      const avgChildScore = childScores.reduce((a, b) => a + b, 0) / childScores.length;
      finalScore = Math.max(c.score, avgChildScore);
    }

    visiting.delete(c.conceptId);
    resolvedScores.set(c.conceptId, finalScore);
    return finalScore;
  }

  // Process roots first, then apply resolved scores back
  const roots = concepts.filter((c) => !c.parentId || !byId.has(c.parentId));
  for (const root of roots) {
    resolveScore(root);
  }

  // Apply resolved scores back immutably
  return concepts.map((c) => ({
    ...c,
    score: resolvedScores.get(c.conceptId) ?? c.score,
  }));
}

export function buildCoverageSnapshot({
  heatmap,
  papers,
  framework,
  citedPaperIds,
}: CoverageComputationInput): Omit<CoverageData, 'isLoading'> {
  const paperMap = new Map<string, Paper>();
  for (const paper of papers) {
    paperMap.set(paper.id, paper);
  }

  const citedSet = new Set(citedPaperIds ?? []);
  const conceptIndexById = new Map(heatmap.conceptIds.map((conceptId, index) => [conceptId, index]));
  const cellsByConceptIndex = new Map<number, HeatmapMatrix['cells']>();

  for (const cell of heatmap.cells) {
    const cells = cellsByConceptIndex.get(cell.conceptIndex);
    if (cells) {
      cells.push(cell);
    } else {
      cellsByConceptIndex.set(cell.conceptIndex, [cell]);
    }
  }

  const concepts = framework.concepts.map((concept) => {
    let synthesized = 0;
    let analyzed = 0;
    let acquired = 0;
    let pending = 0;
    let excluded = 0;

    const conceptIndex = conceptIndexById.get(concept.id);
    const cellsForConcept = conceptIndex == null
      ? []
      : (cellsByConceptIndex.get(conceptIndex) ?? []);

    for (const cell of cellsForConcept) {
      const paperId = heatmap.paperIds[cell.paperIndex];
      if (paperId === undefined) continue;

      const paper = paperMap.get(paperId);
      if (!paper) continue;

      if (paper.relevance === 'excluded') {
        excluded += 1;
      } else if (paper.analysisStatus === 'completed') {
        const isAdjudicated =
          cell.adjudicationStatus === 'accepted' ||
          cell.adjudicationStatus === 'revised';
        const isCited = citedSet.has(paperId);

        if (isAdjudicated && isCited) {
          synthesized += 1;
        } else {
          analyzed += 1;
        }
      } else if (paper.fulltextStatus === 'available') {
        acquired += 1;
      } else {
        pending += 1;
      }
    }

    const coverage: ConceptCoverage = {
      conceptId: concept.id,
      conceptName: concept.nameEn,
      parentId: concept.parentId,
      synthesized,
      analyzed,
      acquired,
      pending,
      excluded,
      total: synthesized + analyzed + acquired + pending + excluded,
      score: 0,
    };

    return {
      ...coverage,
      score: computeConceptScore(coverage),
    };
  });

  const aggregatedConcepts = aggregateTreeScores(concepts);
  const completeness =
    aggregatedConcepts.length > 0
      ? (aggregatedConcepts.reduce((sum, concept) => sum + concept.score, 0) / aggregatedConcepts.length) * 100
      : 0;

  return {
    completeness,
    concepts: aggregatedConcepts,
  };
}

export function useCoverageData(): CoverageData {
  const { data: heatmap, isLoading: heatmapLoading } = useHeatmapData();
  const { data: papers, isLoading: papersLoading } = usePaperList();
  const { data: framework, isLoading: frameworkLoading } = useConceptFramework();
  const { data: citedPaperIds, isLoading: citedLoading } = useAllCitedPaperIds();

  const isLoading = heatmapLoading || papersLoading || frameworkLoading || citedLoading;

  const result = useMemo((): Omit<CoverageData, 'isLoading'> => {
    if (!heatmap || !papers || !framework) {
      return { completeness: 0, concepts: [] };
    }
    return buildCoverageSnapshot({
      heatmap,
      papers,
      framework,
      citedPaperIds,
    });
  }, [heatmap, papers, framework, citedPaperIds]);

  return {
    ...result,
    isLoading,
  };
}
