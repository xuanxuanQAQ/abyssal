/**
 * SelectionSlice — 选中状态（v1.1 双模型选择）
 *
 * 跨视图共享的当前选中实体。
 *
 * v1.1 修订：selectedPaperIds 从 string[] 改为双模型结构：
 * - explicit 模式：explicitIds 记录被选中的 ID（适合少量选中）
 * - allExcept 模式：反选模型，excludedIds 记录被排除的 ID（适合全选后取消个别）
 * 使用 Record<string, true> 替代 Set<string> 以兼容 immer 中间件。
 * 查找复杂度 O(1)。
 */

import type { StateCreator } from 'zustand';
import type { NavigationSlice } from './navigationSlice';
import type { PanelSlice } from './panelSlice';
import type { SearchSlice } from './searchSlice';
import type { PipelineSlice } from './pipelineSlice';
import type { LibrarySlice } from './librarySlice';
import type { GraphSlice } from './graphSlice';

export type PaperSelectionMode = 'explicit' | 'allExcept';

export interface SelectionSlice {
  selectedPaperId: string | null;
  selectionMode: PaperSelectionMode;
  explicitIds: Record<string, true>;
  excludedIds: Record<string, true>;
  selectionAnchorId: string | null;

  selectedConceptId: string | null;
  selectedMappingId: string | null;
  /** 选中映射时附带的 paperId / conceptId（用于 ContextSource 派生） */
  selectedMappingPaperId: string | null;
  selectedMappingConceptId: string | null;
  selectedSectionId: string | null;
  /** 选中节时附带的 articleId（用于 ContextSource 派生） */
  selectedArticleId: string | null;
  focusedGraphNodeId: string | null;

  selectPaper: (id: string | null) => void;
  togglePaperSelection: (id: string) => void;
  selectPaperRange: (ids: string[]) => void;
  selectAllPapers: () => void;
  deselectAllPapers: () => void;
  selectConcept: (id: string | null) => void;
  selectMapping: (id: string | null, paperId?: string, conceptId?: string) => void;
  selectSection: (id: string | null, articleId?: string) => void;
  focusGraphNode: (id: string | null) => void;
  clearSelection: () => void;
}

type FullStore = NavigationSlice &
  SelectionSlice &
  PanelSlice &
  SearchSlice &
  PipelineSlice &
  LibrarySlice &
  GraphSlice;

export const createSelectionSlice: StateCreator<
  FullStore,
  [['zustand/immer', never]],
  [],
  SelectionSlice
> = (set) => ({
  selectedPaperId: null,
  selectionMode: 'explicit',
  explicitIds: {},
  excludedIds: {},
  selectionAnchorId: null,

  selectedConceptId: null,
  selectedMappingId: null,
  selectedMappingPaperId: null,
  selectedMappingConceptId: null,
  selectedSectionId: null,
  selectedArticleId: null,
  focusedGraphNodeId: null,

  /** 单击行：切换到 explicit 模式，仅选中此行 */
  selectPaper: (id) =>
    set((state) => {
      state.selectedPaperId = id;
      state.selectionMode = 'explicit';
      state.explicitIds = id ? { [id]: true } : {};
      state.excludedIds = {};
      state.selectionAnchorId = id;
    }),

  /** Ctrl+Click：在当前模式下 toggle 该行 */
  togglePaperSelection: (id) =>
    set((state) => {
      state.selectedPaperId = id;
      if (state.selectionMode === 'explicit') {
        if (state.explicitIds[id]) {
          const next = { ...state.explicitIds };
          delete next[id];
          state.explicitIds = next;
          // 如果已没有选中行，selectedPaperId 重置
          const keys = Object.keys(next);
          state.selectedPaperId = keys.length > 0 ? (keys[keys.length - 1] ?? null) : null;
        } else {
          state.explicitIds = { ...state.explicitIds, [id]: true };
        }
      } else {
        // allExcept 模式
        if (state.excludedIds[id]) {
          // 重新选中（从 excluded 移除）
          const next = { ...state.excludedIds };
          delete next[id];
          state.excludedIds = next;
        } else {
          state.excludedIds = { ...state.excludedIds, [id]: true };
        }
      }
    }),

  /** Shift+Click：范围选择（由调用方计算好 rangeIds） */
  selectPaperRange: (ids) =>
    set((state) => {
      state.selectionMode = 'explicit';
      const map: Record<string, true> = {};
      for (const id of ids) {
        map[id] = true;
      }
      state.explicitIds = map;
      state.excludedIds = {};
      if (ids.length > 0) {
        state.selectedPaperId = ids[ids.length - 1] ?? null;
      }
    }),

  /** 全选（Ctrl+A / 表头全选 Checkbox） */
  selectAllPapers: () =>
    set((state) => {
      state.selectionMode = 'allExcept';
      state.excludedIds = {};
      state.explicitIds = {};
    }),

  /** 取消全选 */
  deselectAllPapers: () =>
    set((state) => {
      state.selectionMode = 'explicit';
      state.explicitIds = {};
      state.excludedIds = {};
      state.selectedPaperId = null;
      state.selectionAnchorId = null;
    }),

  selectConcept: (id) =>
    set((state) => {
      state.selectedConceptId = id;
    }),

  selectMapping: (id, paperId, conceptId) =>
    set((state) => {
      state.selectedMappingId = id;
      state.selectedMappingPaperId = paperId ?? null;
      state.selectedMappingConceptId = conceptId ?? null;
    }),

  selectSection: (id, articleId) =>
    set((state) => {
      state.selectedSectionId = id;
      state.selectedArticleId = articleId ?? state.selectedArticleId;
    }),

  focusGraphNode: (id) =>
    set((state) => {
      state.focusedGraphNodeId = id;
    }),

  clearSelection: () =>
    set((state) => {
      state.selectedPaperId = null;
      state.selectionMode = 'explicit';
      state.explicitIds = {};
      state.excludedIds = {};
      state.selectionAnchorId = null;
      state.selectedConceptId = null;
      state.selectedMappingId = null;
      state.selectedMappingPaperId = null;
      state.selectedMappingConceptId = null;
      state.selectedSectionId = null;
      state.selectedArticleId = null;
      state.focusedGraphNodeId = null;
    }),
});
