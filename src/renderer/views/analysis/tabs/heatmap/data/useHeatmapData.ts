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
import type {
  ConceptFramework,
  HeatmapCell,
  HeatmapMatrix,
  Paper,
} from '../../../../../../shared-types/models';
import type { Maturity } from '../../../../../../shared-types/enums';
import { cellKey } from '../../../shared/cellKey';

export type SortBy = 'relevance' | 'year' | 'coverage' | 'author';

const RELEVANCE_ORDER: Record<Paper['relevance'], number> = {
  seed: 0,
  high: 1,
  medium: 2,
  low: 3,
  excluded: 4,
};

export interface ConceptGroup {
  id: string;
  name: string;
  conceptIds: string[];
}

export interface ConceptInfo {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  maturity?: Maturity;
}

export interface ProcessedHeatmapSnapshot {
  sortedPaperIds: string[];
  paperLabels: string[];
  conceptGroups: ConceptGroup[];
  orderedConceptIds: string[];
  concepts: ConceptInfo[];
  cellLookup: Map<string, HeatmapCell>;
}

interface ProcessedHeatmapData {
  matrix: HeatmapMatrix | null;
  sortedPaperIds: string[];
  paperLabels: string[];
  conceptGroups: ConceptGroup[];
  orderedConceptIds: string[];
  concepts: ConceptInfo[];
  cellLookup: Map<string, HeatmapCell>;
  isLoading: boolean;
}

/**
 * Format a paper into a short label like "Chen 2024".
 * Falls back to title or a generic paper label if no author info is available.
 */
function makePaperLabel(
  paper: Paper | undefined,
  fallbackIndex: number,
): string {
  const authors = paper?.authors;
  const year = paper?.year;
  if (!authors || authors.length === 0) {
    const title = paper?.title?.trim();
    if (title) {
      return title.length > 36 ? `${title.slice(0, 33)}...` : title;
    }
    return `Paper ${fallbackIndex + 1}`;
  }
  const firstAuthor = authors[0]!.name;
  // Extract surname (last space-separated token)
  const parts = firstAuthor.split(' ');
  const surname = parts[parts.length - 1] ?? firstAuthor;
  return year != null ? `${surname} ${year}` : surname;
}

function buildConceptGroups(
  framework: ConceptFramework | null | undefined,
  matrixConceptIds: string[],
): {
  conceptGroups: ConceptGroup[];
  conceptInfoById: Map<string, ConceptInfo>;
} {
  const conceptInfoById = new Map<string, ConceptInfo>();

  if (!framework) {
    const fallbackGroups = matrixConceptIds.map((conceptId, index) => {
      const fallbackName = `Concept ${index + 1}`;
      conceptInfoById.set(conceptId, {
        id: conceptId,
        name: fallbackName,
        parentId: null,
        level: 0,
      });
      return {
        id: conceptId,
        name: fallbackName,
        conceptIds: [conceptId],
      };
    });
    return { conceptGroups: fallbackGroups, conceptInfoById };
  }

  const conceptById = new Map(framework.concepts.map((concept) => [concept.id, concept]));
  const childrenByParent = new Map<string, string[]>();

  for (const concept of framework.concepts) {
    conceptInfoById.set(concept.id, {
      id: concept.id,
      name: concept.nameEn,
      parentId: concept.parentId,
      level: concept.level,
      maturity: concept.maturity,
    });

    if (!concept.parentId || !conceptById.has(concept.parentId)) {
      continue;
    }

    const siblings = childrenByParent.get(concept.parentId);
    if (siblings) {
      siblings.push(concept.id);
    } else {
      childrenByParent.set(concept.parentId, [concept.id]);
    }
  }

  const seenRoots = new Set<string>();
  const rootIds: string[] = [];

  for (const rootId of framework.rootIds) {
    if (conceptById.has(rootId) && !seenRoots.has(rootId)) {
      seenRoots.add(rootId);
      rootIds.push(rootId);
    }
  }

  for (const concept of framework.concepts) {
    if ((concept.parentId === null || !conceptById.has(concept.parentId)) && !seenRoots.has(concept.id)) {
      seenRoots.add(concept.id);
      rootIds.push(concept.id);
    }
  }

  const conceptGroups: ConceptGroup[] = [];
  const seenConceptIds = new Set<string>();

  const appendSubtree = (conceptId: string, acc: string[]) => {
    acc.push(conceptId);
    seenConceptIds.add(conceptId);

    for (const childId of childrenByParent.get(conceptId) ?? []) {
      appendSubtree(childId, acc);
    }
  };

  for (const rootId of rootIds) {
    const root = conceptById.get(rootId);
    if (!root) {
      continue;
    }

    const conceptIds: string[] = [];
    appendSubtree(rootId, conceptIds);
    conceptGroups.push({
      id: root.id,
      name: root.nameEn,
      conceptIds,
    });
  }

  for (const conceptId of matrixConceptIds) {
    if (seenConceptIds.has(conceptId)) {
      continue;
    }

    if (!conceptInfoById.has(conceptId)) {
      const fallbackName = `Concept ${conceptGroups.length + 1}`;
      conceptInfoById.set(conceptId, {
        id: conceptId,
        name: fallbackName,
        parentId: null,
        level: 0,
      });
    }

    conceptGroups.push({
      id: conceptId,
      name: conceptInfoById.get(conceptId)?.name ?? `Concept ${conceptGroups.length + 1}`,
      conceptIds: [conceptId],
    });
  }

  return { conceptGroups, conceptInfoById };
}

export function buildProcessedHeatmapSnapshot(args: {
  matrix: HeatmapMatrix | null;
  framework: ConceptFramework | null | undefined;
  papers: Paper[] | null | undefined;
  sortBy: SortBy;
  collapsedGroups: Set<string>;
}): ProcessedHeatmapSnapshot {
  const { matrix, framework, papers, sortBy, collapsedGroups } = args;
  const paperMap = new Map<string, Paper>();
  const allPaperIds = new Set<string>();
  for (const paper of papers ?? []) {
    paperMap.set(paper.id, paper);
    allPaperIds.add(paper.id);
  }

  for (const paperId of matrix?.paperIds ?? []) {
    allPaperIds.add(paperId);
  }

  const originalPaperOrder = new Map<string, number>();
  for (const [index, paper] of (papers ?? []).entries()) {
    originalPaperOrder.set(paper.id, index);
  }
  for (const [index, paperId] of (matrix?.paperIds ?? []).entries()) {
    if (!originalPaperOrder.has(paperId)) {
      originalPaperOrder.set(paperId, (papers?.length ?? 0) + index);
    }
  }

  const sortedPaperIds = [...allPaperIds];
  if (sortBy === 'year') {
    sortedPaperIds.sort((a, b) => {
      const pa = paperMap.get(a);
      const pb = paperMap.get(b);
      return (pa?.year ?? 0) - (pb?.year ?? 0)
        || ((originalPaperOrder.get(a) ?? 0) - (originalPaperOrder.get(b) ?? 0));
    });
  } else if (sortBy === 'author') {
    sortedPaperIds.sort((a, b) => {
      const aName = paperMap.get(a)?.authors[0]?.name ?? '';
      const bName = paperMap.get(b)?.authors[0]?.name ?? '';
      return aName.localeCompare(bName)
        || ((originalPaperOrder.get(a) ?? 0) - (originalPaperOrder.get(b) ?? 0));
    });
  } else if (sortBy === 'coverage' && matrix) {
    const cellCountMap = new Map<number, number>();
    for (const cell of matrix.cells) {
      cellCountMap.set(
        cell.paperIndex,
        (cellCountMap.get(cell.paperIndex) ?? 0) + 1,
      );
    }

    const paperIdToOriginalIdx = new Map(matrix.paperIds.map((id, idx) => [id, idx]));
    sortedPaperIds.sort((a, b) => {
      const idxA = paperIdToOriginalIdx.get(a) ?? 0;
      const idxB = paperIdToOriginalIdx.get(b) ?? 0;
      return (cellCountMap.get(idxB) ?? 0) - (cellCountMap.get(idxA) ?? 0)
        || ((originalPaperOrder.get(a) ?? 0) - (originalPaperOrder.get(b) ?? 0));
    });
  } else {
    sortedPaperIds.sort((a, b) => {
      const relevanceA = paperMap.get(a)?.relevance ?? 'low';
      const relevanceB = paperMap.get(b)?.relevance ?? 'low';
      return RELEVANCE_ORDER[relevanceA] - RELEVANCE_ORDER[relevanceB]
        || ((originalPaperOrder.get(a) ?? 0) - (originalPaperOrder.get(b) ?? 0));
    });
  }

  const paperLabels = sortedPaperIds.map((paperId, index) => {
    const paper = paperMap.get(paperId);
    return makePaperLabel(paper, index);
  });

  const {
    conceptGroups,
    conceptInfoById,
  } = buildConceptGroups(framework, matrix?.conceptIds ?? []);

  const orderedConceptIds: string[] = [];
  for (const group of conceptGroups) {
    if (collapsedGroups.has(group.id)) {
      const rootConceptId = group.conceptIds[0];
      if (rootConceptId) {
        orderedConceptIds.push(rootConceptId);
      }
      continue;
    }
    orderedConceptIds.push(...group.conceptIds);
  }

  const concepts = orderedConceptIds.map((conceptId, index) => (
    conceptInfoById.get(conceptId) ?? {
      id: conceptId,
      name: `Concept ${index + 1}`,
      parentId: null,
      level: 0,
    }
  ));

  const cellLookup = new Map<string, HeatmapCell>();
  if (matrix) {
    const paperIdToOriginalIdx = new Map(matrix.paperIds.map((id, idx) => [id, idx]));
    const conceptIdToOriginalIdx = new Map(matrix.conceptIds.map((id, idx) => [id, idx]));
    const originalPaperIdxToSortedIdx = new Map<number, number>();
    const originalConceptIdxToOrderedIdx = new Map<number, number>();

    for (let idx = 0; idx < sortedPaperIds.length; idx++) {
      const originalIdx = paperIdToOriginalIdx.get(sortedPaperIds[idx]!);
      if (originalIdx != null) {
        originalPaperIdxToSortedIdx.set(originalIdx, idx);
      }
    }

    for (let idx = 0; idx < orderedConceptIds.length; idx++) {
      const originalIdx = conceptIdToOriginalIdx.get(orderedConceptIds[idx]!);
      if (originalIdx != null) {
        originalConceptIdxToOrderedIdx.set(originalIdx, idx);
      }
    }

    for (const cell of matrix.cells) {
      const newPaperIdx = originalPaperIdxToSortedIdx.get(cell.paperIndex);
      const newConceptIdx = originalConceptIdxToOrderedIdx.get(cell.conceptIndex);
      if (newPaperIdx == null || newConceptIdx == null) {
        continue;
      }

      cellLookup.set(cellKey(newConceptIdx, newPaperIdx), {
        ...cell,
        conceptIndex: newConceptIdx,
        paperIndex: newPaperIdx,
      });
    }
  }

  return {
    sortedPaperIds,
    paperLabels,
    conceptGroups,
    orderedConceptIds,
    concepts,
    cellLookup,
  };
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

  const processed = useMemo(() => buildProcessedHeatmapSnapshot({
    matrix: matrix ?? null,
    framework,
    papers,
    sortBy,
    collapsedGroups,
  }), [matrix, framework, papers, sortBy, collapsedGroups]);

  return {
    matrix: matrix ?? null,
    sortedPaperIds: processed.sortedPaperIds,
    paperLabels: processed.paperLabels,
    conceptGroups: processed.conceptGroups,
    orderedConceptIds: processed.orderedConceptIds,
    concepts: processed.concepts,
    cellLookup: processed.cellLookup,
    isLoading,
  };
}
