/**
 * ConceptTreeNode — 单个概念树节点（§2.1）
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { MaturityBadge } from '../../../../shared/MaturityBadge';
import type { TreeNode } from './ConceptTree';

interface ConceptTreeNodeProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const MAX_INDENT_DEPTH = 4;

export function ConceptTreeNode({ node, depth, selectedId, onSelect }: ConceptTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const { concept, children } = node;
  const isSelected = concept.id === selectedId;
  const indentPx = Math.min(depth, MAX_INDENT_DEPTH) * 16;
  const hasChildren = children.length > 0;

  return (
    <>
      <div
        onClick={() => onSelect(concept.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px 4px ' + (12 + indentPx) + 'px',
          cursor: 'pointer',
          backgroundColor: isSelected ? 'var(--bg-hover)' : 'transparent',
          outline: isSelected ? '2px solid #3B82F6' : 'none',
          outlineOffset: -2,
          borderRadius: 4,
          marginInline: 4,
        }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        <MaturityBadge maturity={concept.maturity} size="sm" />

        <span style={{
          fontSize: 13, color: 'var(--text-primary)', flex: 1, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {concept.nameZh || concept.name}
        </span>

        {/* TODO: mapping count + approval rate */}
      </div>

      {expanded && children.map((child) => (
        <ConceptTreeNode
          key={child.concept.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
