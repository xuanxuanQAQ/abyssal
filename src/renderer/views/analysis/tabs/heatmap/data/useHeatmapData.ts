/**
 * useProcessedHeatmapData — Wraps core useHeatmapData() + adds sorting and concept grouping.
 *
 * Combines data from three IPC hooks:
 * - useHeatmapData (mappings) → HeatmapMatrix with cells
 * - useConceptFramework (concepts) → concept tree with groups
 * - usePaperList (papers) → paper metadata for sorting/labeling
 *
 * Produces a processed dataset ready for rendering: sorted paper columns,
 * grouped/ordered concept rows, and an O(1) cell lookup map.
 */

import { useMemo } from 'react';
import { useHeatmapData as useRawHeatmapData } from '../../../../../core/ipc/hooks/useMappings';
import { useConceptFramework } from '../../../../../core/ipc/hooks/useConcepts';
import { usePaperList } from '../../../../../core/ipc/hooks/usePapers';
import type { HeatmapMatrix, HeatmapCell, Paper } from '../../../../../../shared-types/models';

export type SortBy = 'relevance' | 'year' | 'coverage' | 'author';

interface ConceptGroup {
  id: string;
  name: string;
  conceptIds: string[];
}

interface ProcessedHeatmapData {
  matrix: HeatmapMatrix | null;
  sortedPaperIds: string[];
  paperLabels: string[];
  conceptGroups: ConceptGroup[];
  orderedConceptIds: string[];
  cellLookup: Map<string, HeatmapCell>;
  isLoading: boolean;
}

/**
 * Format an author name + year into a short label like "Chen 2024".
 * Falls back to first 15 chars of the paper ID if no author info available.
 */
function makePaperLabel(
  authors: Array<{ name: string }> | undefined,
  year: number | undefined,
  paperId: string,
): string {
  if (!authors || authors.length === 0) {
    return paperId.slice(0, 15);
  }
  const firstAuthor = authors[0]!.name;
  // Extract surname (last space-separated token)
  const parts = firstAuthor.split(' ');
  const surname = parts[parts.length - 1] ?? firstAuthor;
  return year != null ? `${surname} ${year}` : surname;
}

export function useProcessedHeatmapData(
  sortBy: SortBy,
  collapsedGroups: Set<string>,
): ProcessedHeatmapData {
  const { data: matrix, isLoading: isMatrixLoading } = useRawHeatmapData();
  const { data: framework, isLoading: isFrameworkLoading } =
    useConceptFramework();
  const { data: papers, isLoading: isPapersLoading } = usePaperList();

  const isLoading = isMatrixLoading || isFrameworkLoading || isPapersLoading;

  // Build paper index map for sorting
  const paperMap = useMemo(() => {
    if (!papers) return new Map<string, Paper>();
    const map = new Map<string, Paper>();
    for (const p of papers) {
      map.set(p.id, p);
    }
    return map;
  }, [papers]);

  // Sort paper IDs
  const sortedPaperIds = useMemo(() => {
    if (!matrix) return [];

    const ids = [...matrix.paperIds];

    if (sortBy === 'year') {
      ids.sort((a, b) => {
        const pa = paperMap.get(a);
        const pb = paperMap.get(b);
        return (pa?.year ?? 0) - (pb?.year ?? 0);
      });
    } else if (sortBy === 'author') {
      ids.sort((a, b) => {
        const pa = paperMap.get(a);
        const pb = paperMap.get(b);
        const aName = pa?.authors[0]?.name ?? '';
        const bName = pb?.authors[0]?.name ?? '';
        return aName.localeCompare(bName);
      });
    } else if (sortBy === 'coverage') {
      // Sort by number of mappings (cells) per paper, descending
      const cellCountMap = new Map<number, number>();
      if (matrix.cells) {
        for (const cell of matrix.cells) {
          cellCountMap.set(
            cell.paperIndex,
            (cellCountMap.get(cell.paperIndex) ?? 0) + 1,
          );
        }
      }
      // Pre-build reverse index to avoid O(n) indexOf inside sort
      const pidToIdx = new Map(matrix.paperIds.map((id, i) => [id, i]));
      ids.sort((a, b) => {
        const idxA = pidToIdx.get(a) ?? 0;
        const idxB = pidToIdx.get(b) ?? 0;
        return (cellCountMap.get(idxB) ?? 0) - (cellCountMap.get(idxA) ?? 0);
      });
    }
    // 'relevance' uses the server-provided default order

    return ids;
  }, [matrix, sortBy, paperMap]);

  // Paper labels
  const paperLabels = useMemo(() => {
    return sortedPaperIds.map((id) => {
      const paper = paperMap.get(id);
      return makePaperLabel(paper?.authors, paper?.year, id);
    });
  }, [sortedPaperIds, paperMap]);

  // Concept groups from framework
  const conceptGroups = useMemo((): ConceptGroup[] => {
    if (!framework) return [];

    // Group concepts by their root parent
    const groups: ConceptGroup[] = [];
    const rootConcepts = framework.concepts.filter(
      (c) => c.parentId === null || framework.rootIds.includes(c.id),
    );

    for (const root of rootConcepts) {
      const childIds = framework.concepts
        .filter((c) => c.parentId === root.id)
        .map((c) => c.id);

      groups.push({
        id: root.id,
        name: root.name,
        conceptIds: [root.id, ...childIds],
      });
    }

    return groups;
  }, [framework]);

  // Ordered concept IDs (respecting collapsed groups)
  const orderedConceptIds = useMemo(() => {
    const result: string[] = [];
    for (const group of conceptGroups) {
      if (collapsedGroups.has(group.id)) {
        // Collapsed: skip children, only count the group header
        continue;
      }
      for (const cid of group.conceptIds) {
        result.push(cid);
      }
    }
    return result;
  }, [conceptGroups, collapsedGroups]);

  // Build O(1) cell lookup map keyed by "conceptIndex:paperIndex"
  // Re-index cells based on the new sorted paper order and ordered concept list
  const cellLookup = useMemo(() => {
    const lookup = new Map<string, HeatmapCell>();
    if (!matrix) return lookup;

    // Pre-build O(1) reverse maps from original ID → original index (avoids O(n) indexOf)
    const paperIdToOriginalIdx = new Map<string, number>();
    for (let i = 0; i < matrix.paperIds.length; i++) {
      paperIdToOriginalIdx.set(matrix.paperIds[i]!, i);
    }
    const conceptIdToOriginalIdx = new Map<string, number>();
    for (let i = 0; i < matrix.conceptIds.length; i++) {
      conceptIdToOriginalIdx.set(matrix.conceptIds[i]!, i);
    }

    // Build reverse maps: originalPaperIdx → sortedIdx, originalConceptIdx → orderedIdx
    const paperIdToSortedIdx = new Map<string, number>();
    for (let i = 0; i < sortedPaperIds.length; i++) {
      const pid = sortedPaperIds[i]!;
      const originalIdx = paperIdToOriginalIdx.get(pid);
      if (originalIdx !== undefined) {
        paperIdToSortedIdx.set(String(originalIdx), i);
      }
    }

    const conceptIdToOrderedIdx = new Map<string, number>();
    for (let i = 0; i < orderedConceptIds.length; i++) {
      const cid = orderedConceptIds[i]!;
      const originalIdx = conceptIdToOriginalIdx.get(cid);
      if (originalIdx !== undefined) {
        conceptIdToOrderedIdx.set(String(originalIdx), i);
      }
    }

    for (const cell of matrix.cells) {
      const newPaperIdx = paperIdToSortedIdx.get(String(cell.paperIndex));
      const newConceptIdx = conceptIdToOrderedIdx.get(
        String(cell.conceptIndex),
      );

      if (newPaperIdx != null && newConceptIdx != null) {
        const key = `${newConceptIdx}:${newPaperIdx}`;
        lookup.set(key, {
          ...cell,
          conceptIndex: newConceptIdx,
          paperIndex: newPaperIdx,
        });
      }
    }

    return lookup;
  }, [matrix, sortedPaperIds, orderedConceptIds]);

  return {
    matrix: matrix ?? null,
    sortedPaperIds,
    paperLabels,
    conceptGroups,
    orderedConceptIds,
    cellLookup,
    isLoading,
  };
}
