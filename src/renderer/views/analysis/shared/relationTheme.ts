/**
 * 关系类型颜色、标签、emoji — 统一定义
 *
 * 所有分析视图组件（colorMap / HeatmapLegend / CellTooltip / MappingReviewList / TableModeView）
 * 从此处引用，消除 4 处重复定义。
 */

import type { RelationType } from '../../../../shared-types/enums';

/** RGB 元组（用于 Canvas 渲染） */
export const RELATION_BASE_RGB: Record<RelationType, [number, number, number]> = {
  supports: [34, 197, 94],
  challenges: [239, 68, 68],
  extends: [99, 102, 241],
  operationalizes: [168, 85, 247],
  irrelevant: [156, 163, 175],
};

/** CSS rgb 字符串（用于 DOM 渲染） */
export const RELATION_COLORS: Record<RelationType, string> = {
  supports: 'rgb(34,197,94)',
  challenges: 'rgb(239,68,68)',
  extends: 'rgb(99,102,241)',
  operationalizes: 'rgb(168,85,247)',
  irrelevant: 'rgb(156,163,175)',
};

/** 中文标签 */
export const RELATION_LABELS_ZH: Record<RelationType, string> = {
  supports: '支持',
  challenges: '挑战',
  extends: '扩展',
  operationalizes: '操作化',
  irrelevant: '无关',
};

/** 英文标签 */
export const RELATION_LABELS_EN: Record<RelationType, string> = {
  supports: 'Supports',
  challenges: 'Challenges',
  extends: 'Extends',
  operationalizes: 'Operationalizes',
  irrelevant: 'Irrelevant',
};

/** Emoji 圆点（用于 ReviewList） */
export const RELATION_EMOJI: Record<RelationType, string> = {
  supports: '\uD83D\uDFE2',
  challenges: '\uD83D\uDD34',
  extends: '\uD83D\uDD35',
  operationalizes: '\uD83D\uDFE3',
  irrelevant: '\u26AA',
};
