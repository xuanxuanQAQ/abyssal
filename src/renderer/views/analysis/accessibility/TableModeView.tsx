import React, { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../../core/store';
import type { HeatmapMatrix, HeatmapCell } from '../../../../shared-types/models';
import type { AdjudicationStatus, RelationType } from '../../../../shared-types/enums';
import { cellKey } from '../shared/cellKey';
import { RELATION_BASE_RGB } from '../shared/relationTheme';
import { ADJUDICATION_INDICATORS } from '../shared/adjudicationIndicators';

// ═══ Types ═══

interface TableModeViewProps {
  matrix: HeatmapMatrix | null;
  conceptNames: string[];
  paperLabels: string[];
  cells: HeatmapCell[];
  numPapers: number;
  numConcepts: number;
  onCellClick: (conceptIndex: number, paperIndex: number, cell: HeatmapCell | null) => void;
  /** Optional lookup: mappingId -> AdjudicationStatus. When provided, adjudication indicators are shown inline. */
  adjudicationMap?: ReadonlyMap<string, AdjudicationStatus> | undefined;
}

type SortDirection = 'asc' | 'desc';

interface SortState {
  column: 'concept' | number; // 'concept' for row header, number for paper column index
  direction: SortDirection;
}

// ═══ Color mapping (mirrors canvas heatmap colors for DOM cells) ═══

// Derive rgba base strings from shared RGB tuples
const BASE_COLORS: Record<RelationType, string> = Object.fromEntries(
  Object.entries(RELATION_BASE_RGB).map(([k, [r, g, b]]) => [k, `rgba(${r},${g},${b}`])
) as Record<RelationType, string>;

const RELATION_ABBREV: Record<RelationType, string> = {
  supports: 'S',
  challenges: 'C',
  extends: 'E',
  operationalizes: 'O',
  irrelevant: 'U',
};

const ADJUDICATION_INDICATOR: Record<AdjudicationStatus, string> = Object.fromEntries(
  Object.entries(ADJUDICATION_INDICATORS).map(([k, v]) => [k, v.symbol ? ` ${v.symbol}` : ''])
) as Record<AdjudicationStatus, string>;

const MIN_OPACITY = 0.15;

function getCellBgColor(relationType: RelationType, confidence: number): string {
  const alpha = MIN_OPACITY + confidence * (1.0 - MIN_OPACITY);
  const base = BASE_COLORS[relationType] ?? BASE_COLORS.irrelevant;
  return `${base},${alpha.toFixed(3)})`;
}

function getSquareColor(relationType: RelationType): string {
  return `${BASE_COLORS[relationType] ?? BASE_COLORS.irrelevant},1)`;
}

// ═══ Styles ═══

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: 'var(--bg-surface)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
};

const bannerStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
  flexShrink: 0,
  userSelect: 'none',
};

const scrollWrapperStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  position: 'relative',
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'separate',
  borderSpacing: 0,
  minWidth: '100%',
};

const stickyCornerStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  top: 0,
  zIndex: 3,
  background: 'var(--bg-surface)',
  padding: '6px 12px',
  borderBottom: '2px solid var(--border-subtle)',
  borderRight: '1px solid var(--border-subtle)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  userSelect: 'none',
  minWidth: 160,
  maxWidth: 220,
};

const colHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--bg-surface)',
  padding: '6px 8px',
  borderBottom: '2px solid var(--border-subtle)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  userSelect: 'none',
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const rowHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: 'var(--bg-surface)',
  padding: '4px 12px',
  borderRight: '1px solid var(--border-subtle)',
  borderBottom: '1px solid var(--border-subtle)',
  fontWeight: 500,
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const cellStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--border-subtle)',
  cursor: 'pointer',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  fontSize: 11,
  minWidth: 56,
};

const emptyStyle: React.CSSProperties = {
  padding: '24px',
  textAlign: 'center',
  color: 'var(--text-muted)',
};

const colorSquareStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: 2,
  marginRight: 3,
  verticalAlign: 'middle',
};

const sortArrowStyle: React.CSSProperties = {
  marginLeft: 4,
  fontSize: 10,
};

// ═══ Component ═══

function TableModeView({
  matrix,
  conceptNames,
  paperLabels,
  cells,
  numPapers,
  numConcepts,
  onCellClick,
  adjudicationMap,
}: TableModeViewProps) {
  const selectMapping = useAppStore((s) => s.selectMapping);

  const [sortState, setSortState] = useState<SortState | null>(null);

  // Build cell lookup: "conceptIndex:paperIndex" -> HeatmapCell
  const cellMap = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    for (const cell of cells) {
      map.set(cellKey(cell.conceptIndex, cell.paperIndex), cell);
    }
    return map;
  }, [cells]);

  // Sorted row indices
  const sortedRowIndices = useMemo(() => {
    const indices = Array.from({ length: numConcepts }, (_, i) => i);

    if (sortState === null) return indices;

    const { column, direction } = sortState;
    const dir = direction === 'asc' ? 1 : -1;

    if (column === 'concept') {
      indices.sort((a, b) => {
        const nameA = conceptNames[a] ?? '';
        const nameB = conceptNames[b] ?? '';
        return dir * nameA.localeCompare(nameB, 'zh-CN');
      });
    } else {
      // Sort by confidence in a specific paper column
      const paperIdx = column;
      indices.sort((a, b) => {
        const cellA = cellMap.get(cellKey(a, paperIdx));
        const cellB = cellMap.get(cellKey(b, paperIdx));
        const confA = cellA?.confidence ?? -1;
        const confB = cellB?.confidence ?? -1;
        return dir * (confA - confB);
      });
    }

    return indices;
  }, [sortState, numConcepts, conceptNames, cellMap]);

  const handleSort = useCallback((column: 'concept' | number) => {
    setSortState((prev) => {
      if (prev !== null && prev.column === column) {
        // Toggle direction, or clear on third click
        if (prev.direction === 'asc') {
          return { column, direction: 'desc' };
        }
        return null; // Clear sort
      }
      return { column, direction: 'asc' };
    });
  }, []);

  const handleCellClick = useCallback(
    (conceptIndex: number, paperIndex: number) => {
      const cell = cellMap.get(cellKey(conceptIndex, paperIndex)) ?? null;
      if (cell !== null) {
        selectMapping(cell.mappingId);
      }
      onCellClick(conceptIndex, paperIndex, cell);
    },
    [cellMap, onCellClick, selectMapping],
  );

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableCellElement>, conceptIndex: number, paperIndex: number) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleCellClick(conceptIndex, paperIndex);
      }
    },
    [handleCellClick],
  );

  const renderSortArrow = useCallback(
    (column: 'concept' | number) => {
      if (sortState === null || sortState.column !== column) return null;
      return (
        <span style={sortArrowStyle} aria-hidden="true">
          {sortState.direction === 'asc' ? '\u25B2' : '\u25BC'}
        </span>
      );
    },
    [sortState],
  );

  if (matrix === null) {
    return <div style={emptyStyle}>暂无热力图数据</div>;
  }

  if (numConcepts === 0 || numPapers === 0) {
    return <div style={emptyStyle}>概念或论文数据为空</div>;
  }

  return (
    <div style={containerStyle} role="region" aria-label="热力图表格视图">
      <div style={bannerStyle}>
        表格视图 &mdash; Ctrl+Shift+T 返回热力图
      </div>

      <div style={scrollWrapperStyle}>
        <table style={tableStyle} aria-label="概念-论文映射矩阵">
          <thead>
            <tr>
              {/* Sticky corner */}
              <th
                style={stickyCornerStyle}
                scope="col"
                onClick={() => handleSort('concept')}
                aria-sort={
                  sortState !== null && sortState.column === 'concept'
                    ? sortState.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                概念{renderSortArrow('concept')}
              </th>

              {/* Paper column headers */}
              {paperLabels.map((label, colIdx) => (
                <th
                  key={colIdx}
                  style={colHeaderStyle}
                  scope="col"
                  title={label}
                  onClick={() => handleSort(colIdx)}
                  aria-sort={
                    sortState !== null && sortState.column === colIdx
                      ? sortState.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  {label}{renderSortArrow(colIdx)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sortedRowIndices.map((rowIdx) => {
              const conceptName = conceptNames[rowIdx] ?? `Concept ${rowIdx}`;
              return (
                <tr key={rowIdx}>
                  <th scope="row" style={rowHeaderStyle} title={conceptName}>
                    {conceptName}
                  </th>

                  {Array.from({ length: numPapers }, (_, colIdx) => {
                    const cell = cellMap.get(cellKey(rowIdx, colIdx));

                    if (cell === undefined) {
                      return (
                        <td
                          key={colIdx}
                          style={{
                            ...cellStyle,
                            color: 'var(--text-muted)',
                          }}
                          tabIndex={0}
                          role="gridcell"
                          aria-label={`${conceptName}, ${paperLabels[colIdx] ?? `Paper ${colIdx}`}: 无映射`}
                          onClick={() => handleCellClick(rowIdx, colIdx)}
                          onKeyDown={(e) => handleCellKeyDown(e, rowIdx, colIdx)}
                        >
                          &mdash;
                        </td>
                      );
                    }

                    const bgColor = getCellBgColor(cell.relationType, cell.confidence);
                    const squareColor = getSquareColor(cell.relationType);
                    const abbrev = RELATION_ABBREV[cell.relationType] ?? '?';
                    const adjStatus = adjudicationMap?.get(cell.mappingId);
                    const adjIndicator = adjStatus !== undefined ? (ADJUDICATION_INDICATOR[adjStatus] ?? '') : '';
                    const confText = cell.confidence.toFixed(2);

                    return (
                      <td
                        key={colIdx}
                        style={{
                          ...cellStyle,
                          backgroundColor: bgColor,
                        }}
                        tabIndex={0}
                        role="gridcell"
                        aria-label={`${conceptName}, ${paperLabels[colIdx] ?? `Paper ${colIdx}`}: ${cell.relationType} ${confText}${adjIndicator}`}
                        onClick={() => handleCellClick(rowIdx, colIdx)}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, colIdx)}
                      >
                        <span
                          style={{
                            ...colorSquareStyle,
                            backgroundColor: squareColor,
                          }}
                        />
                        {abbrev} {confText}{adjIndicator}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { TableModeView };
export type { TableModeViewProps };
