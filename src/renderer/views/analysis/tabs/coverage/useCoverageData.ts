/**
 * useCoverageData -- Derives coverage statistics from heatmap, paper counts,
 * and concept framework data.
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
 * TODO: "synthesized" status needs writing citation data (Sub-Doc 7 citedPaperIds).
 * For now, all 'accepted'/'revised' mappings are treated as "analyzed".
 */

import { useMemo } from 'react';
import { useHeatmapData } from '../../../../core/ipc/hooks/useMappings';
import { usePaperList } from '../../../../core/ipc/hooks/usePapers';
import { useConceptFramework } from '../../../../core/ipc/hooks/useConcepts';
import type { Paper, HeatmapMatrix, ConceptFramework } from '../../../../../shared-types/models';
import type { AnalysisStatus, AdjudicationStatus } from '../../../../../shared-types/enums';

export interface ConceptCoverage {
  conceptId: string;
  conceptName: string;
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

function computeConceptScore(coverage: ConceptCoverage): number {
  if (coverage.synthesized >= 3) return 1.0;
  if (coverage.synthesized >= 1) return 0.7;
  if (coverage.analyzed >= 1) return 0.4;
  if (coverage.acquired >= 1) return 0.2;
  return 0.0;
}

export function useCoverageData(): CoverageData {
  const { data: heatmap, isLoading: heatmapLoading } = useHeatmapData();
  const { data: papers, isLoading: papersLoading } = usePaperList();
  const { data: framework, isLoading: frameworkLoading } = useConceptFramework();

  const isLoading = heatmapLoading || papersLoading || frameworkLoading;

  const result = useMemo((): Omit<CoverageData, 'isLoading'> => {
    if (!heatmap || !papers || !framework) {
      return { completeness: 0, concepts: [] };
    }

    // Build paper lookup for analysis status
    const paperMap = new Map<string, Paper>();
    for (const p of papers) {
      paperMap.set(p.id, p);
    }

    // Build concept name lookup
    const conceptNameMap = new Map<string, string>();
    for (const c of framework.concepts) {
      conceptNameMap.set(c.id, c.name);
    }

    // For each concept, count papers by their effective status bucket
    const concepts: ConceptCoverage[] = heatmap.conceptIds.map(
      (conceptId, conceptIndex) => {
        let synthesized = 0;
        let analyzed = 0;
        let acquired = 0;
        let pending = 0;
        let excluded = 0;

        // Find all cells for this concept
        const cellsForConcept = heatmap.cells.filter(
          (cell) => cell.conceptIndex === conceptIndex,
        );

        for (const cell of cellsForConcept) {
          const paperId = heatmap.paperIds[cell.paperIndex];
          if (paperId === undefined) continue;
          const paper = paperMap.get(paperId);
          if (!paper) continue;

          // Classify based on paper analysis status and relevance
          if (paper.relevance === 'excluded') {
            excluded++;
          } else if (paper.analysisStatus === 'completed') {
            // TODO: distinguish synthesized vs analyzed once citation
            // data is available. For now, treat all completed-analysis
            // mappings as "analyzed".
            analyzed++;
          } else if (paper.fulltextStatus === 'available') {
            acquired++;
          } else {
            pending++;
          }
        }

        const total = synthesized + analyzed + acquired + pending + excluded;
        const coverage: ConceptCoverage = {
          conceptId,
          conceptName: conceptNameMap.get(conceptId) ?? conceptId,
          synthesized,
          analyzed,
          acquired,
          pending,
          excluded,
          total,
          score: 0,
        };
        coverage.score = computeConceptScore(coverage);
        return coverage;
      },
    );

    // completeness = average of all concept scores * 100
    const completeness =
      concepts.length > 0
        ? (concepts.reduce((sum, c) => sum + c.score, 0) / concepts.length) * 100
        : 0;

    return { completeness, concepts };
  }, [heatmap, papers, framework]);

  return {
    ...result,
    isLoading,
  };
}
