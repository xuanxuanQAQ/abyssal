/**
 * ConceptTreeNode — 单个概念树节点（§2.1）
 *
 * Features:
 * - Expand/collapse children
 * - Keyboard navigation (Enter to select, Space to toggle)
 * - Mapping count + reviewed progress display
 * - role="treeitem" for accessibility
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { MaturityBadge } from '../../../../shared/MaturityBadge';
import { useConceptStats } from '../../../../core/ipc/hooks/useConcepts';
import type { TreeNode } from './ConceptTree';

interface ConceptTreeNodeProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const MAX_INDENT_DEPTH = 4;

export const ConceptTreeNode = React.memo(function ConceptTreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: ConceptTreeNodeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const { concept, children } = node;
  const isSelected = concept.id === selectedId;
  const indentPx = Math.min(depth, MAX_INDENT_DEPTH) * 16;
  const hasChildren = children.length > 0;

  const { data: stats } = useConceptStats(concept.id);
  const mappingCount = stats?.mappingCount ?? 0;
  const paperCount = stats?.paperCount ?? 0;
  const reviewedCount = stats?.reviewedCount ?? 0;
  const reviewedRate =
    mappingCount > 0 ? Math.round((reviewedCount / mappingCount) * 100) : 0;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          onSelect(concept.id);
          break;
        case ' ':
          e.preventDefault();
          if (hasChildren) setExpanded((prev) => !prev);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (hasChildren && !expanded) setExpanded(true);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (hasChildren && expanded) setExpanded(false);
          break;
      }
    },
    [concept.id, onSelect, hasChildren, expanded],
  );

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={isSelected}
      aria-level={depth + 1}
      style={{ listStyle: 'none' }}
    >
      <div
        onClick={() => onSelect(concept.id)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
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
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            aria-label={expanded ? t('analysis.concepts.tree.collapse') : t('analysis.concepts.tree.expand')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              flexShrink: 0,
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        <MaturityBadge maturity={concept.maturity} size="sm" />

        <span
          style={{
            fontSize: 13,
            color: 'var(--text-primary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {concept.nameZh || concept.name}
        </span>

        {/* Mapping count + approval rate */}
        {mappingCount > 0 && (
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            title={t('analysis.concepts.tree.mappingSummary', {
              mappingCount,
              paperCount,
              reviewedCount,
              reviewedPct: reviewedRate,
            })}
          >
            <span>{mappingCount}</span>
            <span
              style={{
                display: 'inline-block',
                width: 20,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: 'var(--border-subtle)',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${reviewedRate}%`,
                  height: '100%',
                  backgroundColor: 'var(--success)',
                  borderRadius: 1.5,
                }}
              />
            </span>
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <ul role="group" style={{ margin: 0, padding: 0 }}>
          {children.map((child) => (
            <ConceptTreeNode
              key={child.concept.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
});
