/**
 * 全局导航协议类型定义
 *
 * 所有跨视图跳转统一使用 NavigationTarget 类型。
 */

import type { ViewType } from '../../../shared-types/enums';

/** 跳转到论文 */
export interface PaperTarget {
  type: 'paper';
  id: string;
  view: ViewType;
  pdfPage?: number;
}

/** 跳转到概念（Analysis 视图） */
export interface ConceptTarget {
  type: 'concept';
  id: string;
}

/** 跳转到文章节（Writing 视图） */
export interface SectionTarget {
  type: 'section';
  articleId: string;
  sectionId: string;
}

/** 跳转到图焦点节点（Graph 视图） */
export interface GraphFocusTarget {
  type: 'graph';
  focusNodeId: string;
}

/** v2.0 跳转到结构化笔记 */
export interface NoteTarget {
  type: 'note';
  noteId: string;
}

/** v2.0 跳转到碎片笔记 */
export interface MemoTarget {
  type: 'memo';
  memoId: string;
}

/** 导航目标联合类型 */
export type NavigationTarget =
  | PaperTarget
  | ConceptTarget
  | SectionTarget
  | GraphFocusTarget
  | NoteTarget
  | MemoTarget;
