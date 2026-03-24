/**
 * PaperTable — 表格顶层（§3）
 *
 * TanStack Table 实例化 + VirtualizedBody + TableHeader + BatchActionBar。
 * 集成虚拟化、排序、选择、内联编辑。
 */

import React, { useMemo, startTransition, useState, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from '@tanstack/react-table';
import { useAppStore } from '../../../core/store';
import { usePaperTableColumns } from '../hooks/usePaperTableColumns';
import { usePaperSort } from '../hooks/usePaperSort';
import { usePaperSelection } from '../hooks/usePaperSelection';
import { useRowExpansion } from '../hooks/useRowExpansion';
import { TableToolbar } from './TableToolbar';
import { TableHeader } from './TableHeader';
import { VirtualizedBody } from './VirtualizedBody';
import { BatchActionBar } from './BatchActionBar';
import { SkeletonRows } from './SkeletonRows';
import type { Paper } from '../../../../shared-types/models';
import type { PaperFilter } from '../../../../shared-types/ipc';

interface PaperTableProps {
  papers: Paper[];
  isLoading: boolean;
  filter: PaperFilter | undefined;
}

export function PaperTable({ papers, isLoading, filter }: PaperTableProps) {
  const librarySearchQuery = useAppStore((s) => s.librarySearchQuery);
  const libraryColumnSizing = useAppStore((s) => s.libraryColumnSizing);
  const setLibraryColumnSizing = useAppStore((s) => s.setLibraryColumnSizing);

  const columns = usePaperTableColumns();
  const { sorting, setSorting, handleSortClick } = usePaperSort();
  const { isExpanded, toggleRowExpansion, expandedRowIds } = useRowExpansion();

  // §4.5 大数据量首屏优化：先渲染 100 行
  const [visibleData, setVisibleData] = useState<Paper[]>([]);
  useEffect(() => {
    if (papers.length <= 2000) {
      setVisibleData(papers);
    } else {
      // 先渲染前 100 行
      setVisibleData(papers.slice(0, 100));
      startTransition(() => {
        setVisibleData(papers);
      });
    }
  }, [papers]);

  // 前端搜索过滤（§8.2）
  const filteredData = useMemo(() => {
    if (!librarySearchQuery.trim()) return visibleData;

    const tokens = librarySearchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    return visibleData.filter((paper) => {
      const searchable = `${paper.title} ${paper.authors.map((a) => a.name).join(' ')}`.toLowerCase();
      return tokens.every((token) => searchable.includes(token));
    });
  }, [visibleData, librarySearchQuery]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      columnSizing: libraryColumnSizing,
    },
    onSortingChange: setSorting,
    onColumnSizingChange: (updater) => {
      const newSizing = typeof updater === 'function'
        ? updater(libraryColumnSizing)
        : updater;
      setLibraryColumnSizing(newSizing);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    enableSorting: true,
    enableMultiSort: true,
    maxMultiSortColCount: 3,
  });

  const sortedRows = table.getRowModel().rows;
  const sortedPapers = useMemo(
    () => sortedRows.map((r) => r.original),
    [sortedRows]
  );

  const selection = usePaperSelection(sortedPapers);

  // Ctrl+A 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        selection.selectAllPapers();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection.selectAllPapers]);

  return (
    <div
      role="grid"
      aria-rowcount={filteredData.length}
      aria-colcount={columns.length}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <TableToolbar filter={filter} resultCount={filteredData.length} />

      {isLoading ? (
        <SkeletonRows />
      ) : (
        <>
          <TableHeader
            headerGroups={table.getHeaderGroups()}
            sorting={sorting}
            onSortClick={handleSortClick}
            allSelectedState={selection.allSelectedState}
            onToggleSelectAll={selection.toggleSelectAll}
            table={table}
          />

          <VirtualizedBody
            rows={sortedRows}
            isSelected={selection.isSelected}
            isExpanded={isExpanded}
            onRowClick={selection.handleRowClick}
            onToggleExpansion={toggleRowExpansion}
            expandedRowIds={expandedRowIds}
            selectedPaperId={selection.selectedPaperId}
          />
        </>
      )}

      {selection.selectedCount >= 2 && (
        <BatchActionBar
          selectedCount={selection.selectedCount}
          onDeselect={selection.deselectAllPapers}
          getSelectedIds={selection.getSelectedIds}
          papers={sortedPapers}
        />
      )}
    </div>
  );
}
