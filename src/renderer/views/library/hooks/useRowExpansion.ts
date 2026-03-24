/**
 * useRowExpansion — 行展开/折叠状态（§4.1）
 *
 * 读写 useAppStore.expandedRowIds。
 * 驱动 estimateSize 返回值切换（40px 正常 / 160px 展开预估）。
 */

import { useCallback } from 'react';
import { useAppStore } from '../../../core/store';

export function useRowExpansion() {
  const expandedRowIds = useAppStore((s) => s.expandedRowIds);
  const toggleRowExpansion = useAppStore((s) => s.toggleRowExpansion);

  const isExpanded = useCallback(
    (rowId: string): boolean => !!expandedRowIds[rowId],
    [expandedRowIds]
  );

  /** 用于 @tanstack/react-virtual 的 estimateSize */
  const estimateSize = useCallback(
    (index: number, rows: Array<{ id: string }>) => {
      const row = rows[index];
      if (row && expandedRowIds[row.id]) return 160;
      return 40;
    },
    [expandedRowIds]
  );

  return { isExpanded, toggleRowExpansion, estimateSize, expandedRowIds };
}
