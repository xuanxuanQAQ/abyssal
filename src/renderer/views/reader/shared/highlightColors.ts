/**
 * 高亮颜色常量 — Reader 模块统一定义
 *
 * 替代 5 个文件中的重复定义：
 * AnnotationCard / ColorPicker / SelectionToolbar / AnnotationLayer / ThumbnailNav
 */

import type { HighlightColor } from '../../../../shared-types/enums';

/** 高亮背景色 */
export const HIGHLIGHT_COLOR_MAP: Record<HighlightColor, string> = {
  yellow: 'rgb(255, 237, 120)',
  green: 'rgb(144, 238, 170)',
  red: 'rgb(255, 160, 160)',
  blue: 'rgb(160, 200, 255)',
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
