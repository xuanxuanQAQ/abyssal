/**
 * NavigationSlice — 导航状态
 *
 * 管理 activeView、previousView、navigationStack。
 * 导航操作通过 navigateTo action 执行。
 */

import type { StateCreator } from 'zustand';
import type { ViewType } from '../../../../shared-types/enums';
import type { NavigationTarget } from '../../navigation/types';
import { applyNavigation, resolveTargetView } from '../../navigation/navigateTo';
import type { SelectionSlice } from './selectionSlice';
import type { PanelSlice } from './panelSlice';
import type { SearchSlice } from './searchSlice';
import type { PipelineSlice } from './pipelineSlice';
import type { LibrarySlice } from './librarySlice';
import type { GraphSlice } from './graphSlice';
import type { NotesSlice } from './notesSlice';

export interface NavigationSlice {
  activeView: ViewType;
  previousView: ViewType | null;
  navigationStack: NavigationTarget[];

  navigateTo: (target: NavigationTarget) => void;
  /** 简单视图切换（不涉及实体选择，仅维护 previousView） */
  switchView: (view: ViewType) => void;
  goBack: () => void;
}

function restoreSelectionFromTarget(state: SelectionSlice, target: NavigationTarget): void {
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
  state.selectedDraftId = null;
  state.focusedGraphNodeId = null;
  state.focusedGraphNodeType = null;
  state.selectedMemoId = null;
  state.selectedNoteId = null;

  switch (target.type) {
    case 'paper':
      state.selectedPaperId = target.id;
      state.explicitIds = { [target.id]: true };
      state.selectionAnchorId = target.id;
      break;
    case 'concept':
      state.selectedConceptId = target.id;
      break;
    case 'section':
      state.selectedSectionId = target.sectionId;
      state.selectedArticleId = target.articleId;
      state.selectedDraftId = target.draftId ?? null;
      break;
    case 'graph':
      state.focusedGraphNodeId = target.focusNodeId;
      break;
    case 'note':
      state.selectedNoteId = target.noteId;
      break;
    case 'memo':
      state.selectedMemoId = target.memoId;
      break;
  }
}

export const createNavigationSlice: StateCreator<
  NavigationSlice & SelectionSlice & PanelSlice & SearchSlice & PipelineSlice & LibrarySlice & GraphSlice & NotesSlice,
  [['zustand/immer', never]],
  [],
  NavigationSlice
> = (set, get) => ({
  activeView: 'library',
  previousView: null,
  navigationStack: [],

  navigateTo: (target) => {
    applyNavigation(
      target,
      () => ({
        activeView: get().activeView,
        navigationStack: get().navigationStack,
      }),
      (partial) => set((state) => Object.assign(state, partial))
    );
  },

  switchView: (view) =>
    set((state) => {
      state.previousView = state.activeView;
      state.activeView = view;
    }),

  goBack: () => {
    const stack = get().navigationStack;
    if (stack.length < 2) return;
    const currentView = get().activeView;
    const prev = stack[stack.length - 2];
    if (prev) {
      set((state) => {
        state.navigationStack = stack.slice(0, -1);
        state.previousView = currentView;
        state.activeView = resolveTargetView(prev);
        restoreSelectionFromTarget(state, prev);
      });
    }
  },
});
