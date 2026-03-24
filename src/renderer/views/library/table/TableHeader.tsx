/**
 * TableHeader — 冻结表头（§4.3、§3.4）
 *
 * position: sticky; top: 0; z-index: 15。
 * 列标题 + 排序箭头 + 多级排序角标。
 * 全选 Checkbox 三态。
 */

import React from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import { ArrowUp, ArrowDown, ArrowUpDown, Check, Minus } from 'lucide-react';
import { ColumnResizeHandle } from './ColumnResizeHandle';
import { Z_INDEX } from '../../../styles/zIndex';
import type { HeaderGroup, SortingState, Table as TanStackTable } from '@tanstack/react-table';
import type { Paper } from '../../../../shared-types/models';

interface TableHeaderProps {
  headerGroups: HeaderGroup<Paper>[];
  sorting: SortingState;
  onSortClick: (columnId: string, isShift: boolean) => void;
  allSelectedState: 'none' | 'all' | 'indeterminate';
  onToggleSelectAll: () => void;
  table: TanStackTable<Paper>;
}

export function TableHeader({
  headerGroups,
  sorting,
  onSortClick,
  allSelectedState,
  onToggleSelectAll,
  table,
}: TableHeaderProps) {
  return (
    <div
      role="row"
      aria-rowindex={1}
      style={{
        display: 'flex',
        position: 'sticky',
        top: 0,
        zIndex: Z_INDEX.STICKY_HEADER,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '2px solid var(--border-subtle)',
        flexShrink: 0,
        minHeight: 32,
      }}
    >
      {headerGroups.map((headerGroup) =>
        headerGroup.headers.map((header) => {
          const columnId = header.column.id;
          const canSort = header.column.getCanSort();
          const sortEntry = sorting.find((s) => s.id === columnId);
          const sortIndex = sorting.findIndex((s) => s.id === columnId);

          if (columnId === 'select') {
            return (
              <div
                key={header.id}
                role="columnheader"
                style={{
                  flex: `0 0 ${header.getSize()}px`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                <Checkbox.Root
                  checked={allSelectedState === 'all' ? true : allSelectedState === 'indeterminate' ? 'indeterminate' : false}
                  onCheckedChange={onToggleSelectAll}
                  style={{
                    width: 16,
                    height: 16,
                    border: '1px solid var(--border-default)',
                    borderRadius: 3,
                    backgroundColor: allSelectedState !== 'none' ? 'var(--accent-color)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Checkbox.Indicator>
                    {allSelectedState === 'indeterminate' ? (
                      <Minus size={10} style={{ color: '#fff' }} />
                    ) : (
                      <Check size={10} style={{ color: '#fff' }} />
                    )}
                  </Checkbox.Indicator>
                </Checkbox.Root>
              </div>
            );
          }

          return (
            <div
              key={header.id}
              role="columnheader"
              aria-sort={
                sortEntry ? (sortEntry.desc ? 'descending' : 'ascending') : 'none'
              }
              onClick={(e) => {
                if (canSort) onSortClick(columnId, e.shiftKey);
              }}
              style={{
                flex: columnId === 'title' ? `1 1 ${header.getSize()}px` : `0 0 ${header.getSize()}px`,
                minWidth: header.column.columnDef.minSize,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '0 8px',
                cursor: canSort ? 'pointer' : 'default',
                userSelect: 'none',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <span style={{ flex: 1 }}>
                {typeof header.column.columnDef.header === 'string'
                  ? header.column.columnDef.header
                  : columnId}
              </span>
              {canSort && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {sortEntry ? (
                    <>
                      {sortEntry.desc ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                      {sorting.length > 1 && (
                        <span style={{ fontSize: 8, fontWeight: 700 }}>
                          {sortIndex + 1}
                        </span>
                      )}
                    </>
                  ) : (
                    <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                  )}
                </span>
              )}
              {header.column.getCanResize() && (
                <ColumnResizeHandle header={header} table={table} />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
