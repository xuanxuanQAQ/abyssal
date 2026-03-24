/**
 * useDragSafeState — v1.1 拖拽状态上提 Hook（§12.1.1）
 *
 * onDragStart 时保存 active.id/active.data 到上层 state，
 * 防止虚拟列表源行卸载中断拖拽。
 *
 * DragOverlay 和 onDragEnd 从此 state 读取数据，
 * 不依赖源 DOM 节点的存活。
 */

import { useState, useCallback } from 'react';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import type { PaperDragData } from '../hooks/usePaperDrag';

interface DragSafeState {
  activeId: string | null;
  activeData: PaperDragData | null;
}

export function useDragSafeState() {
  const [dragState, setDragState] = useState<DragSafeState>({
    activeId: null,
    activeData: null,
  });

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as PaperDragData | undefined;
    if (data?.type === 'paper') {
      setDragState({
        activeId: String(event.active.id),
        activeData: data,
      });
    }
  }, []);

  const handleDragEnd = useCallback((_event: DragEndEvent) => {
    // 清理拖拽状态
    setDragState({ activeId: null, activeData: null });
  }, []);

  return {
    activeId: dragState.activeId,
    activeData: dragState.activeData,
    handleDragStart,
    handleDragEnd,
  };
}
