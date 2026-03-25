/**
 * SearchSlice — 搜索 UI 状态
 *
 * Cmd+K 全局搜索、Library 本地搜索、Graph 节点搜索。
 */

import type { StateCreator } from 'zustand';
import type { NavigationSlice } from './navigationSlice';
import type { SelectionSlice } from './selectionSlice';
import type { PanelSlice } from './panelSlice';
import type { PipelineSlice } from './pipelineSlice';
import type { LibrarySlice } from './librarySlice';
import type { GraphSlice } from './graphSlice';
import type { NotesSlice } from './notesSlice';

export interface SearchSlice {
  globalSearchOpen: boolean;
  globalSearchQuery: string;
  librarySearchQuery: string;
  graphSearchQuery: string;

  openGlobalSearch: () => void;
  closeGlobalSearch: () => void;
  setGlobalSearchQuery: (query: string) => void;
  setLibrarySearchQuery: (query: string) => void;
  setGraphSearchQuery: (query: string) => void;
}

export const createSearchSlice: StateCreator<
  NavigationSlice & SelectionSlice & PanelSlice & SearchSlice & PipelineSlice & LibrarySlice & GraphSlice & NotesSlice,
  [['zustand/immer', never]],
  [],
  SearchSlice
> = (set) => ({
  globalSearchOpen: false,
  globalSearchQuery: '',
  librarySearchQuery: '',
  graphSearchQuery: '',

  openGlobalSearch: () =>
    set((state) => {
      state.globalSearchOpen = true;
      state.globalSearchQuery = '';
    }),

  closeGlobalSearch: () =>
    set((state) => {
      state.globalSearchOpen = false;
      state.globalSearchQuery = '';
    }),

  setGlobalSearchQuery: (query) =>
    set((state) => {
      state.globalSearchQuery = query;
    }),

  setLibrarySearchQuery: (query) =>
    set((state) => {
      state.librarySearchQuery = query;
    }),

  setGraphSearchQuery: (query) =>
    set((state) => {
      state.graphSearchQuery = query;
    }),
});
