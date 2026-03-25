/**
 * ConceptTree — 概念树（§2.1）
 *
 * 从扁平列表构建内存树，@dnd-kit/sortable 拖拽调整层级，
 * drop 前做环路检测。
 */

import React, { useMemo } from 'react';
import { useConceptList } from '../../../../core/ipc/hooks/useConcepts';
import { useAppStore } from '../../../../core/store';
import { ConceptTreeNode } from './ConceptTreeNode';
import type { Concept } from '../../../../../shared-types/models';

interface TreeNode {
  concept: Concept;
  children: TreeNode[];
}

function buildTree(concepts: Concept[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const c of concepts) {
    map.set(c.id, { concept: c, children: [] });
  }

  for (const c of concepts) {
    const node = map.get(c.id)!;
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children.push(node);
    } else {
      if (c.parentId) {
        console.warn(`ConceptTree: invalid parent_id "${c.parentId}" for concept "${c.id}"`);
      }
      roots.push(node);
    }
  }

  // Sort: established > working > tentative
  const maturityOrder = { established: 0, working: 1, tentative: 2 };
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (maturityOrder[a.concept.maturity] ?? 2) - (maturityOrder[b.concept.maturity] ?? 2));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);

  return roots;
}

export function ConceptTree() {
  const { data: concepts } = useConceptList();
  const selectedConceptId = useAppStore((s) => s.selectedConceptId);
  const selectConcept = useAppStore((s) => s.selectConcept);

  const tree = useMemo(() => buildTree(concepts ?? []), [concepts]);

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{
        padding: '6px 12px', fontSize: 11, fontWeight: 600,
        color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        概念框架
      </div>
      {tree.map((node) => (
        <ConceptTreeNode
          key={node.concept.id}
          node={node}
          depth={0}
          selectedId={selectedConceptId}
          onSelect={selectConcept}
        />
      ))}
      {tree.length === 0 && (
        <div style={{ padding: '16px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
          暂无概念，通过 AI 建议或手动创建添加
        </div>
      )}
    </div>
  );
}

export type { TreeNode };
export { buildTree };
