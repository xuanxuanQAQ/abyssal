/**
 * VirtualizedBody — @tanstack/react-virtual 虚拟化容器（§4）
 *
 * estimateSize: 40px 正常行 / 160px 展开行。
 * overscan: 15。
 * measureElement 动态高度。
 * 滚动位置驻留/恢复（§1.2）。
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppStore } from '../../../core/store';
import { PaperRow } from './PaperRow';
import type { Row } from '@tanstack/react-table';
import type { Paper } from '../../../../shared-types/models';

interface VirtualizedBodyProps {
  rows: Row<Paper>[];
  isSelected: (rowId: string) => boolean;
  isExpanded: (rowId: string) => boolean;
  onRowClick: (rowId: string, e: React.MouseEvent) => void;
  onToggleExpansion: (rowId: string) => void;
  onToggleSelect: (rowId: string) => void;
  expandedRowIds: Record<string, true>;
  selectedPaperId: string | null;
}

export function VirtualizedBody({
  rows,
  isSelected,
  isExpanded,
  onRowClick,
  onToggleExpansion,
  onToggleSelect,
  expandedRowIds,
  selectedPaperId,
}: VirtualizedBodyProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const libraryScrollOffset = useAppStore((s) => s.libraryScrollOffset);
  const setLibraryScrollOffset = useAppStore((s) => s.setLibraryScrollOffset);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row && expandedRowIds[row.original.id]) return 160;
      return 40;
    },
    overscan: 15,
    initialOffset: libraryScrollOffset,
  });

  // 保存滚动位置（视图切换时驻留）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      setLibraryScrollOffset(el.scrollTop);
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [setLibraryScrollOffset]);

  // 键盘行导航（§5.3）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedPaperId) return;
      const currentIndex = rows.findIndex((r) => r.original.id === selectedPaperId);
      if (currentIndex === -1) return;

      let targetIndex: number;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          targetIndex = Math.min(currentIndex + 1, rows.length - 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          targetIndex = Math.max(currentIndex - 1, 0);
          break;
        case 'Home':
          e.preventDefault();
          targetIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          targetIndex = rows.length - 1;
          break;
        case 'PageDown':
          e.preventDefault();
          targetIndex = Math.min(currentIndex + 18, rows.length - 1);
          break;
        case 'PageUp':
          e.preventDefault();
          targetIndex = Math.max(currentIndex - 18, 0);
          break;
        default:
          return;
      }

      if (targetIndex !== currentIndex) {
        const targetRow = rows[targetIndex];
        if (targetRow) {
          // 模拟单击（或 Shift 扩展）
          onRowClick(targetRow.original.id, {
            shiftKey: e.shiftKey,
            ctrlKey: false,
            metaKey: false,
          } as React.MouseEvent);
          virtualizer.scrollToIndex(targetIndex, { align: 'auto' });
        }
      }
    },
    [selectedPaperId, rows, onRowClick, virtualizer]
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        flex: 1,
        overflow: 'auto',
        willChange: 'transform',
        outline: 'none',
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const paperId = row.original.id;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <PaperRow
                row={row}
                isSelected={isSelected(paperId)}
                isExpanded={isExpanded(paperId)}
                isFocused={selectedPaperId === paperId}
                onClick={(e) => onRowClick(paperId, e)}
                onToggleExpansion={() => onToggleExpansion(paperId)}
                onToggleSelect={() => onToggleSelect(paperId)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
