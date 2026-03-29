import type { AnnotationId, PaperId, ConceptId } from './common';
import type { AnnotationType } from '../../shared-types/enums';

// ═══ 字面量联合 + const 数组 ═══
// 唯一定义源在 shared-types/enums（使用 camelCase: 'conceptTag'）。

export type { AnnotationType };

export const ANNOTATION_TYPES = [
  'highlight',
  'note',
  'conceptTag',
] as const;

// ═══ PdfRect ═══

/** PDF 坐标矩形（左下原点坐标系，单位 PDF points） */
export interface PdfRect {
  x0: number; // 左边界
  y0: number; // 下边界
  x1: number; // 右边界（x0 < x1）
  y1: number; // 上边界（y0 < y1）
}

// ═══ Annotation ═══

export interface Annotation {
  id: AnnotationId;
  paperId: PaperId;
  page: number; // PDF 页码（从 0 开始）
  rect: PdfRect;
  selectedText: string;
  type: AnnotationType;
  color: string; // CSS 颜色值，如 "#FFEB3B"
  comment: string | null;
  conceptId: ConceptId | null; // 仅 conceptTag 类型有值
  createdAt: string; // ISO 8601
}
