/**
 * RowHeader — Row headers with concept names.
 *
 * overflow: hidden, position: sticky; left: 0; z-index: 2.
 * Inner content translates with CSS transform: translateY(-scrollTop).
 * Group headers: background var(--bg-surface-high), font-weight 600, clickable.
 * Individual rows: 28px height, font-size 12px, 8px padding, ellipsis overflow.
 * Hovered row gets var(--bg-hover) background.
 */

import React, { useMemo, useCallback } from 'react';
import {
  ROW_HEADER_WIDTH,
  CELL_HEIGHT,
  CELL_GAP,
  CONCEPT_GROUP_GAP,
} from './layoutConstants';

interface ConceptInfo {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
}

interface ConceptGroup {
  id: string;
  name: string;
  conceptIds: string[];
}

interface RowHeaderProps {
  concepts: ConceptInfo[];
  groups: ConceptGroup[];
  collapsedGroups: Set<string>;
  onToggleGroup: (groupId: string) => void;
  scrollTop: number;
  hoveredRow: number | null;
  rowOffsets: number[];
}

export function RowHeader({
  concepts,
  groups,
  collapsedGroups,
  onToggleGroup,
  scrollTop,
  hoveredRow,
  rowOffsets,
}: RowHeaderProps) {
  const handleToggle = useCallback(
    (groupId: string) => {
      onToggleGroup(groupId);
    },
    [onToggleGroup],
  );

  // Build a map from concept index to group membership for group-header rendering
  const groupStartIndices = useMemo(() => {
    const result = new Map<number, ConceptGroup>();
    let idx = 0;
    for (const group of groups) {
      if (!collapsedGroups.has(group.id)) {
        result.set(idx, group);
        idx += group.conceptIds.length;
      } else {
        result.set(idx, group);
        // collapsed: only the header row counts, concepts are hidden
        idx += 0;
      }
    }
    return result;
  }, [groups, collapsedGroups]);

  // Total height for the inner container
  const totalHeight =
    concepts.length > 0
      ? (rowOffsets[concepts.length - 1] ?? 0) + CELL_HEIGHT + CELL_GAP
      : 0;

  return (
    <div
      style={{
        position: 'sticky',
        left: 0,
        zIndex: 2,
        overflow: 'hidden',
        width: ROW_HEADER_WIDTH,
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: ROW_HEADER_WIDTH,
          height: totalHeight,
          transform: `translateY(${-scrollTop}px)`,
          willChange: 'transform',
        }}
      >
        {/* Group headers */}
        {groups.map((group) => {
          const firstConceptIdx = concepts.findIndex(
            (c) => c.id === group.conceptIds[0],
          );
          if (firstConceptIdx < 0) return null;

          const isCollapsed = collapsedGroups.has(group.id);
          const yOffset = (rowOffsets[firstConceptIdx] ?? 0) - CONCEPT_GROUP_GAP;

          return (
            <button
              key={`group-${group.id}`}
              type="button"
              onClick={() => handleToggle(group.id)}
              style={{
                position: 'absolute',
                top: Math.max(0, yOffset),
                left: 0,
                width: ROW_HEADER_WIDTH,
                height: CONCEPT_GROUP_GAP > 0 ? CONCEPT_GROUP_GAP + 4 : 20,
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                background: 'var(--bg-surface-high)',
                border: 'none',
                borderBottom: '1px solid var(--border-subtle)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 11,
                color: 'var(--text-primary)',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={group.name}
            >
              <span style={{ marginRight: 4, fontSize: 10 }}>
                {isCollapsed ? '▶' : '▼'}
              </span>
              {group.name}
            </button>
          );
        })}

        {/* Individual concept rows */}
        {concepts.map((concept, idx) => {
          const yOffset = rowOffsets[idx] ?? 0;
          const isHovered = hoveredRow === idx;

          return (
            <div
              key={concept.id}
              style={{
                position: 'absolute',
                top: yOffset,
                left: 0,
                width: ROW_HEADER_WIDTH,
                height: CELL_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                paddingLeft: 8 + concept.level * 12,
                fontSize: 12,
                lineHeight: `${CELL_HEIGHT}px`,
                color: 'var(--text-primary)',
                backgroundColor: isHovered ? 'var(--bg-hover)' : 'transparent',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                userSelect: 'none',
                boxSizing: 'border-box',
              }}
              title={concept.name}
            >
              {concept.name}
            </div>
          );
        })}
      </div>
    </div>
  );
}
