/**
 * 高亮颜色常量 — Reader 模块统一定义
 *
 * 替代 5 个文件中的重复定义：
 * AnnotationCard / ColorPicker / SelectionToolbar / AnnotationLayer / ThumbnailNav
 */

import type { HighlightColor } from '../../../../shared-types/enums';

/** 高亮背景色（半透明，叠加在白底 canvas 上不遮挡文字） */
export const HIGHLIGHT_COLOR_MAP: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 237, 0, 0.30)',
  green: 'rgba(0, 200, 80, 0.25)',
  red: 'rgba(255, 80, 80, 0.25)',
  blue: 'rgba(80, 160, 255, 0.25)',
};

/** 高亮边框色（用于 ColorPicker 选中态） */
export const HIGHLIGHT_BORDER_MAP: Record<HighlightColor, string> = {
  yellow: 'rgb(200, 180, 60)',
  green: 'rgb(80, 180, 110)',
  red: 'rgb(200, 100, 100)',
  blue: 'rgb(100, 140, 200)',
};

/** 中文标签 */
export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '黄色',
  green: '绿色',
  red: '红色',
  blue: '蓝色',
};

/** 所有颜色枚举值 */
export const ALL_HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'red', 'blue'];
