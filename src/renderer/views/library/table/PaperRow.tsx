/**
 * PaperRow — 单行渲染（§6, §4.4）
 *
 * React.memo 包裹，比较 row.id + isSelected + isExpanded + isFocused。
 * 渲染 10 列 Cell。展开时显示 abstract 区域。
 */

import React, { memo, useRef, useEffect } from 'react';
import { SelectCell } from './cells/SelectCell';
import { RelevanceCell } from './cells/RelevanceCell';
import { TitleCell } from './cells/TitleCell';
import { AuthorsCell } from './cells/AuthorsCell';
import { YearCell } from './cells/YearCell';
import { PaperTypeCell } from './cells/PaperTypeCell';
import { FulltextStatusCell } from './cells/FulltextStatusCell';
import { AnalysisStatusCell } from './cells/AnalysisStatusCell';
import { DecisionNoteCell } from './cells/DecisionNoteCell';
import { DateAddedCell } from './cells/DateAddedCell';
import { RowContextMenu } from './RowContextMenu';
import { usePaperDrag } from '../hooks/usePaperDrag';
import type { Row } from '@tanstack/react-table';
import type { Paper } from '../../../../shared-types/models';

interface PaperRowProps {
  row: Row<Paper>;
  isSelected: boolean;
  isExpanded: boolean;
  isFocused: boolean;
  onClick: (e: React.MouseEvent) => void;
  onToggleExpansion: () => void;
  onToggleSelect: () => void;
}

export const PaperRow = memo(
  function PaperRow({
    row,
    isSelected,
    isExpanded,
    isFocused,
    onClick,
    onToggleExpansion,
    onToggleSelect,
  }: PaperRowProps) {
    const paper = row.original;
    const { dragRef, dragAttributes, dragListeners } = usePaperDrag(paper);
    const cells = row.getVisibleCells();

    // §4.1.1 展开行 ResizeObserver
    const abstractRef = useRef<HTMLDivElement>(null);

    return (
      <RowContextMenu paper={paper} isSelected={isSelected}>
        <div
          ref={dragRef}
          {...dragAttributes}
          {...dragListeners}
          role="row"
          aria-rowindex={row.index + 2}
          aria-selected={isSelected}
          onClick={onClick}
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: isFocused
              ? 'var(--accent-color-10)'
              : isSelected
                ? 'var(--accent-color-06)'
                : 'transparent',
            borderLeft: isFocused
              ? '3px solid var(--accent-color)'
              : '3px solid transparent',
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          {/* 主行 */}
          <div style={{ display: 'flex', minHeight: 40, alignItems: 'center' }}>
            {cells.map((cell) => {
              const columnId = cell.column.id;
              const size = cell.column.getSize();
              const style: React.CSSProperties = {
                flex: columnId === 'title' ? `1 1 ${size}px` : `0 0 ${size}px`,
                minWidth: cell.column.columnDef.minSize,
                padding: '0 8px',
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
              };

              return (
                <div key={cell.id} role="gridcell" style={style}>
                  {columnId === 'select' && (
                    <SelectCell isSelected={isSelected} onToggle={onToggleSelect} />
                  )}
                  {columnId === 'relevance' && (
                    <RelevanceCell paper={paper} />
                  )}
                  {columnId === 'title' && (
                    <TitleCell
                      paper={paper}
                      isExpanded={isExpanded}
                      onToggleExpansion={onToggleExpansion}
                    />
                  )}
                  {columnId === 'authors' && (
                    <AuthorsCell authors={paper.authors} />
                  )}
                  {columnId === 'year' && (
                    <YearCell year={paper.year} />
                  )}
                  {columnId === 'paperType' && (
                    <PaperTypeCell paperType={paper.paperType} />
                  )}
                  {columnId === 'fulltextStatus' && (
                    <FulltextStatusCell status={paper.fulltextStatus} />
                  )}
                  {columnId === 'analysisStatus' && (
                    <AnalysisStatusCell status={paper.analysisStatus} />
                  )}
                  {columnId === 'decisionNote' && (
                    <DecisionNoteCell paperId={paper.id} note={paper.decisionNote} />
                  )}
                  {columnId === 'dateAdded' && (
                    <DateAddedCell dateAdded={paper.dateAdded} />
                  )}
                </div>
              );
            })}
          </div>

          {/* 展开区域：abstract */}
          {isExpanded && paper.abstract && (
            <div
              ref={abstractRef}
              style={{
                padding: '4px 8px 8px 52px',
                borderTop: '1px dashed var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                lineHeight: 1.6,
              }}
            >
              {paper.abstract}
            </div>
          )}
        </div>
      </RowContextMenu>
    );
  },
  (prev, next) =>
    prev.row.original.id === next.row.original.id &&
    prev.isSelected === next.isSelected &&
    prev.isExpanded === next.isExpanded &&
    prev.isFocused === next.isFocused &&
    prev.row.original === next.row.original
);
