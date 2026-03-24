/**
 * usePaperDrag — 论文行拖拽 Hook（§12.1）
 *
 * useDraggable 配置 PointerSensor { delay: 150, tolerance: 5 }。
 * 拖拽数据：{ type: 'paper', paperId, title, firstAuthor, year }
 */

import { useDraggable } from '@dnd-kit/core';
import type { Paper } from '../../../../shared-types/models';

export interface PaperDragData {
  type: 'paper';
  paperId: string;
  title: string;
  firstAuthor: string;
  year: number;
}

export function usePaperDrag(paper: Paper) {
  const firstAuthor = paper.authors[0]?.name ?? 'Unknown';

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-paper:${paper.id}`,
    data: {
      type: 'paper',
      paperId: paper.id,
      title: paper.title,
      firstAuthor,
      year: paper.year,
    } satisfies PaperDragData,
  });

  return {
    dragRef: setNodeRef,
    dragAttributes: attributes,
    dragListeners: listeners,
    isDragging,
  };
}
