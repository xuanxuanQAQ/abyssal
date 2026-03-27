/**
 * usePaperSelection — v1.1 双模型选择逻辑（§5.1）
 *
 * explicit 模式：explicitIds 存储选中的 ID（O(1) 查找）
 * allExcept 模式：excludedIds 存储被排除的 ID（全选后取消个别行）
 *
 * 提供 isSelected(rowId)、selectedCount、操作函数。
 */

import { useCallback, useMemo } from 'react';
import { useAppStore } from '../../../core/store';
import type { Paper } from '../../../../shared-types/models';

export function usePaperSelection(sortedRows: Paper[]) {
  const selectedPaperId = useAppStore((s) => s.selectedPaperId);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const explicitIds = useAppStore((s) => s.explicitIds);
  const excludedIds = useAppStore((s) => s.excludedIds);
  const selectionAnchorId = useAppStore((s) => s.selectionAnchorId);

  const selectPaper = useAppStore((s) => s.selectPaper);
  const togglePaperSelection = useAppStore((s) => s.togglePaperSelection);
  const selectPaperRange = useAppStore((s) => s.selectPaperRange);
  const selectAllPapers = useAppStore((s) => s.selectAllPapers);
  const deselectAllPapers = useAppStore((s) => s.deselectAllPapers);

  /** O(1) 选中判定 */
  const isSelected = useCallback(
    (rowId: string): boolean => {
      if (selectionMode === 'explicit') return !!explicitIds[rowId];
      return !excludedIds[rowId]; // allExcept
    },
    [selectionMode, explicitIds, excludedIds]
  );

  /** 选中计数 */
  const selectedCount = useMemo(() => {
    if (selectionMode === 'explicit') return Object.keys(explicitIds).length;
    return sortedRows.length - Object.keys(excludedIds).length;
  }, [selectionMode, explicitIds, excludedIds, sortedRows.length]);

  /** 处理行点击（含修饰键逻辑） */
  const handleRowClick = useCallback(
    (rowId: string, e: React.MouseEvent) => {
      if (e.shiftKey && selectionAnchorId) {
        // Shift+Click: 范围选择
        const anchorIndex = sortedRows.findIndex((r) => r.id === selectionAnchorId);
        const currentIndex = sortedRows.findIndex((r) => r.id === rowId);
        if (anchorIndex >= 0 && currentIndex >= 0) {
          const start = Math.min(anchorIndex, currentIndex);
          const end = Math.max(anchorIndex, currentIndex);
          const rangeIds = sortedRows.slice(start, end + 1).map((r) => r.id);
          selectPaperRange(rangeIds);
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click: toggle
        togglePaperSelection(rowId);
      } else {
        // 普通单击：再次点击已选中的行则取消选中
        if (selectedPaperId === rowId && selectionMode === 'explicit' && Object.keys(explicitIds).length === 1) {
          deselectAllPapers();
        } else {
          selectPaper(rowId);
        }
      }
    },
    [selectionAnchorId, sortedRows, selectPaper, togglePaperSelection, selectPaperRange, selectedPaperId, selectionMode, explicitIds, deselectAllPapers]
  );

  /** 全选 Checkbox 三态 */
  const allSelectedState = useMemo((): 'none' | 'all' | 'indeterminate' => {
    if (selectedCount === 0) return 'none';
    if (selectionMode === 'allExcept' && Object.keys(excludedIds).length === 0) return 'all';
    if (selectedCount === sortedRows.length) return 'all';
    return 'indeterminate';
  }, [selectedCount, selectionMode, excludedIds, sortedRows.length]);

  /** 表头全选 toggle */
  const toggleSelectAll = useCallback(() => {
    if (allSelectedState === 'all') {
      deselectAllPapers();
    } else {
      selectAllPapers();
    }
  }, [allSelectedState, selectAllPapers, deselectAllPapers]);

  /** 获取选中的 ID 列表（批量操作用，allExcept 模式下展开） */
  const getSelectedIds = useCallback((): string[] => {
    if (selectionMode === 'explicit') return Object.keys(explicitIds);
    return sortedRows
      .filter((r) => !excludedIds[r.id])
      .map((r) => r.id);
  }, [selectionMode, explicitIds, excludedIds, sortedRows]);

  return {
    selectedPaperId,
    isSelected,
    selectedCount,
    handleRowClick,
    togglePaperSelection,
    allSelectedState,
    toggleSelectAll,
    selectAllPapers,
    deselectAllPapers,
    getSelectedIds,
  };
}
