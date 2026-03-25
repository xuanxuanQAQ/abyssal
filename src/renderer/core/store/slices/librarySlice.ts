/**
 * LibrarySlice — Library 视图驻留状态（§1.2）
 *
 * "DOM 销毁 + 状态驻留"：视图切换时以下状态留在 Store 中，
 * 切回 Library 视图时瞬间恢复。
 */

import type { StateCreator } from 'zustand';
import type { NavigationSlice } from './navigationSlice';
import type { SelectionSlice } from './selectionSlice';
import type { GraphSlice } from './graphSlice';
import type { PanelSlice } from './panelSlice';
import type { SearchSlice } from './searchSlice';
import type { PipelineSlice } from './pipelineSlice';
import type { NotesSlice } from './notesSlice';

export type LibraryGroupType = 'smart' | 'tag' | 'search';

export interface LibrarySlice {
  activeGroupId: string;
  activeGroupType: LibraryGroupType;
  activeTagIds: string[];
  libraryScrollOffset: number;
  libraryColumnSizing: Record<string, number>;
  expandedRowIds: Record<string, true>;

  setActiveGroup: (id: string, type: LibraryGroupType) => void;
  setActiveTagIds: (ids: string[]) => void;
  toggleActiveTagId: (id: string) => void;
  setLibraryScrollOffset: (offset: number) => void;
  setLibraryColumnSizing: (sizing: Record<string, number>) => void;
  toggleRowExpansion: (rowId: string) => void;
  clearExpandedRows: () => void;
}

type FullStore = NavigationSlice &
  SelectionSlice &
  PanelSlice &
  SearchSlice &
  PipelineSlice &
  LibrarySlice &
  GraphSlice &
  NotesSlice;

export const createLibrarySlice: StateCreator<
  FullStore,
  [['zustand/immer', never]],
  [],
  LibrarySlice
> = (set) => ({
  activeGroupId: 'all',
  activeGroupType: 'smart',
  activeTagIds: [],
  libraryScrollOffset: 0,
  libraryColumnSizing: {},
  expandedRowIds: {},

  setActiveGroup: (id, type) =>
    set((state) => {
      state.activeGroupId = id;
      state.activeGroupType = type;
      // 切换分组时重置滚动位置和选择
      state.libraryScrollOffset = 0;
      if (type !== 'tag') {
        state.activeTagIds = [];
      }
    }),

  setActiveTagIds: (ids) =>
    set((state) => {
      state.activeTagIds = ids;
    }),

  toggleActiveTagId: (id) =>
    set((state) => {
      const idx = state.activeTagIds.indexOf(id);
      if (idx >= 0) {
        state.activeTagIds.splice(idx, 1);
      } else {
        state.activeTagIds.push(id);
      }
      state.activeGroupType = 'tag';
      state.activeGroupId = id;
    }),

  setLibraryScrollOffset: (offset) =>
    set((state) => {
      state.libraryScrollOffset = offset;
    }),

  setLibraryColumnSizing: (sizing) =>
    set((state) => {
      state.libraryColumnSizing = sizing;
    }),

  toggleRowExpansion: (rowId) =>
    set((state) => {
      if (state.expandedRowIds[rowId]) {
        const next = { ...state.expandedRowIds };
        delete next[rowId];
        state.expandedRowIds = next;
      } else {
        state.expandedRowIds = { ...state.expandedRowIds, [rowId]: true };
      }
    }),

  clearExpandedRows: () =>
    set((state) => {
      state.expandedRowIds = {};
    }),
});
