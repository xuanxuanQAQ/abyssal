/**
 * useOutlineData -- Combines outline data with computed numbering
 *
 * Aggregates section tree into a flat view with:
 * - Numbered sections via computeNumbering
 * - Total word count across all sections
 * - Completed / total section counts
 */

import { useMemo } from 'react';
import { useArticleOutline } from '../../../core/ipc/hooks/useArticles';
import { computeNumbering, type NumberingMap } from '../outline/useNumbering';
import type { SectionNode } from '../../../../shared-types/models';
import type { SectionStatus } from '../../../../shared-types/enums';

interface OutlineData {
  sections: SectionNode[];
  numbering: NumberingMap;
  totalWordCount: number;
  completedCount: number;
  totalCount: number;
}

/** Statuses considered "completed" for progress tracking */
const COMPLETED_STATUSES: ReadonlySet<SectionStatus> = new Set<SectionStatus>([
  'finalized',
  'revised',
]);

/**
 * Recursively traverse the section tree, accumulating word counts
 * and status tallies.
 */
function aggregateSections(
  nodes: readonly SectionNode[],
  stats: { wordCount: number; completed: number; total: number },
): void {
  for (const node of nodes) {
    stats.total += 1;
    stats.wordCount += node.wordCount;
    if (COMPLETED_STATUSES.has(node.status)) {
      stats.completed += 1;
    }
    if (node.children.length > 0) {
      aggregateSections(node.children, stats);
    }
  }
}

export function useOutlineData(articleId: string | null): OutlineData {
  const { data: outline } = useArticleOutline(articleId);

  return useMemo((): OutlineData => {
    if (outline === undefined) {
      return {
        sections: [],
        numbering: {},
        totalWordCount: 0,
        completedCount: 0,
        totalCount: 0,
      };
    }

    const sections = outline.sections;
    const numbering = computeNumbering(sections);

    const stats = { wordCount: 0, completed: 0, total: 0 };
    aggregateSections(sections, stats);

    return {
      sections,
      numbering,
      totalWordCount: stats.wordCount,
      completedCount: stats.completed,
      totalCount: stats.total,
    };
  }, [outline]);
}
