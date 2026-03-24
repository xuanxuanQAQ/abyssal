/**
 * usePaperSort — 排序状态管理（§3.4）
 *
 * 支持最多三级排序。
 * 单击：设为第一排序键（升序）
 * 再次单击：切换为降序
 * 第三次：取消该列排序
 * Shift+Click：追加为次级排序键
 */

import { useState, useCallback } from 'react';
import type { SortingState } from '@tanstack/react-table';

export function usePaperSort() {
  const [sorting, setSorting] = useState<SortingState>([]);

  const handleSortClick = useCallback(
    (columnId: string, isShift: boolean) => {
      setSorting((prev) => {
        const existing = prev.find((s) => s.id === columnId);

        if (isShift) {
          // Shift+Click: 追加为次级排序键（最多三级）
          if (existing) {
            // 已存在：切换方向
            return prev.map((s) =>
              s.id === columnId ? { ...s, desc: !s.desc } : s
            );
          }
          if (prev.length >= 3) return prev;
          return [...prev, { id: columnId, desc: false }];
        }

        // 普通单击
        if (!existing) {
          // 设为第一排序键（升序）
          return [{ id: columnId, desc: false }];
        }

        if (!existing.desc) {
          // 升序 → 降序
          return [{ id: columnId, desc: true }];
        }

        // 降序 → 取消
        return [];
      });
    },
    []
  );

  return { sorting, setSorting, handleSortClick };
}
