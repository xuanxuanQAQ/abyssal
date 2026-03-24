/**
 * DndProvider — 全局拖拽上下文（§9）
 *
 * @dnd-kit DndContext 包装组件。
 * - onDragStart: 注入 body.is-dragging 类（§9.3 性能防护）
 * - onDragEnd/onDragCancel: 移除该类
 * - DragOverlay 使用 Portal 渲染
 *
 * 挂载在 MainLayout 的 workspace 区域内部，
 * 包裹 MainStage + ContextPanel（§9.5）。
 */

import React, { useState, useCallback, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragCancelEvent,
} from '@dnd-kit/core';
import { DragPreview, type DragItem } from './DragPreview';

interface DndProviderProps {
  children: ReactNode;
}

export function DndProvider({ children }: DndProviderProps) {
  const [activeDrag, setActiveDrag] = useState<DragItem | null>(null);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const sensors = useSensors(pointerSensor);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    // §9.3 注入全局拖拽类
    document.body.classList.add('is-dragging');

    const data = event.active.data.current;
    // 类型安全守卫：验证 data 符合 DragItem 结构
    if (data && typeof data === 'object' && 'type' in data && 'id' in data && 'title' in data) {
      setActiveDrag(data as DragItem);
    }
  }, []);

  const handleDragEnd = useCallback((_event: DragEndEvent) => {
    document.body.classList.remove('is-dragging');
    setActiveDrag(null);

    // TODO: 根据 event.over 的 droppableId 执行对应 drop 动作
    // 具体拖拽场景在 Sub-Doc 4~8 中注册
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    document.body.classList.remove('is-dragging');
    setActiveDrag(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeDrag && <DragPreview item={activeDrag} />}
      </DragOverlay>
    </DndContext>
  );
}
