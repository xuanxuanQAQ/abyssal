/**
 * useOutlineTree -- react-arborist configuration hook
 *
 * Provides:
 *  - `treeData`   : SectionNode[] -> TreeNodeData[] for react-arborist
 *  - `disableDrop` : prevents dropping on own descendants + enforces max depth 4
 *  - `onMove`      : computes new parentId + sortIndex, calls useUpdateOutlineOrder
 *  - `onRename`    : title patch via useUpdateSection
 */

import { useCallback, useMemo } from 'react';
import type { MoveHandler, RenameHandler } from 'react-arborist';
import type { SectionNode, SectionOrder } from '../../../../shared-types/models';
import type { SectionStatus, EvidenceStatus } from '../../../../shared-types/enums';
import {
  useUpdateOutlineOrder,
  useUpdateSection,
} from '../../../core/ipc/hooks/useArticles';

export interface TreeNodeData {
  id: string;
  name: string;
  status: SectionStatus;
  wordCount: number;
  writingInstructions: string | null;
  parentId: string | null;
  sortIndex: number;
  evidenceStatus?: EvidenceStatus | undefined;
  evidenceGaps?: string[] | undefined;
  children: TreeNodeData[];
}

// ── helpers ──

/** Convert SectionNode[] to react-arborist TreeNodeData[] */
function toTreeData(sections: SectionNode[]): TreeNodeData[] {
  return sections.map((s) => ({
    id: s.id,
    name: s.title,
    status: s.status,
    wordCount: s.wordCount,
    writingInstructions: s.writingInstructions,
    parentId: s.parentId,
    sortIndex: s.sortIndex,
    evidenceStatus: s.evidenceStatus,
    evidenceGaps: s.evidenceGaps,
    children: toTreeData(s.children),
  }));
}

/** Collect all descendant ids (inclusive) */
function collectDescendantIds(node: TreeNodeData): Set<string> {
  const ids = new Set<string>();
  const stack: TreeNodeData[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    ids.add(current.id);
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return ids;
}

/** Find a node by id in the tree */
function findNode(
  nodes: TreeNodeData[],
  id: string,
): TreeNodeData | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return undefined;
}

/** Compute depth of a node in the tree (root = 0) */
function nodeDepth(nodes: TreeNodeData[], id: string, depth: number = 0): number {
  for (const n of nodes) {
    if (n.id === id) return depth;
    const found = nodeDepth(n.children, id, depth + 1);
    if (found >= 0) return found;
  }
  return -1;
}

/** Compute maximum depth of a subtree */
function subtreeMaxDepth(node: TreeNodeData): number {
  if (node.children.length === 0) return 0;
  let max = 0;
  for (const child of node.children) {
    const d = subtreeMaxDepth(child) + 1;
    if (d > max) max = d;
  }
  return max;
}

// ── hook ──

export function useOutlineTree(articleId: string, sections: SectionNode[]) {
  const updateOutlineOrder = useUpdateOutlineOrder();
  const updateSection = useUpdateSection();

  const treeData = useMemo(() => toTreeData(sections), [sections]);

  /**
   * disableDrop:
   * 1. Cannot drop a node onto its own descendants
   * 2. Cannot exceed max depth of 4 levels (0-3)
   */
  const disableDrop = useCallback(
    (args: {
      dragNodes: Array<{ id: string; data: TreeNodeData }>;
      parentNode: { id: string; data: TreeNodeData } | null;
    }): boolean => {
      const { dragNodes, parentNode } = args;

      for (const dragNode of dragNodes) {
        const dragged = findNode(treeData, dragNode.id);
        if (!dragged) continue;

        // Prevent drop on own descendants
        if (parentNode) {
          const descendantIds = collectDescendantIds(dragged);
          if (descendantIds.has(parentNode.id)) {
            return true;
          }
        }

        // Enforce max depth: parentDepth + 1 + subtreeMaxDepth(dragged) <= 4
        if (parentNode) {
          const parentDepth = nodeDepth(treeData, parentNode.id);
          const draggedSubtreeDepth = subtreeMaxDepth(dragged);
          if (parentDepth + 1 + draggedSubtreeDepth > 4) {
            return true;
          }
        } else {
          // Dropping at root level
          const draggedSubtreeDepth = subtreeMaxDepth(dragged);
          if (draggedSubtreeDepth > 3) {
            return true;
          }
        }
      }

      return false;
    },
    [treeData],
  );

  /**
   * onMove: compute new parentId + sortIndex from react-arborist move info,
   * then batch-update via useUpdateOutlineOrder.
   */
  const onMove: MoveHandler<TreeNodeData> = useCallback(
    (args: { dragIds: string[]; parentId: string | null; index: number }) => {
      const { dragIds, parentId, index } = args;

      const orders: SectionOrder[] = dragIds.map((id: string, i: number) => ({
        sectionId: id,
        parentId: parentId ?? null,
        sortIndex: index + i,
      }));

      updateOutlineOrder.mutate({ articleId, order: orders });
    },
    [articleId, updateOutlineOrder],
  );

  /**
   * onRename: update section title via useUpdateSection
   */
  const onRename: RenameHandler<TreeNodeData> = useCallback(
    (args: { id: string; name: string }) => {
      const { id, name } = args;
      const trimmed = name.trim();
      if (trimmed) {
        updateSection.mutate({ sectionId: id, patch: { title: trimmed } });
      }
    },
    [updateSection],
  );

  return {
    treeData,
    disableDrop,
    onMove,
    onRename,
  };
}
