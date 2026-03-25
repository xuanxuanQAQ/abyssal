/**
 * NavigationSlice — 导航状态
 *
 * 管理 activeView、previousView、navigationStack。
 * 导航操作通过 navigateTo action 执行。
 */

import type { StateCreator } from 'zustand';
import type { ViewType } from '../../../../shared-types/enums';
import type { NavigationTarget } from '../../navigation/types';
import { applyNavigation } from '../../navigation/navigateTo';
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
    // 弹出当前，跳转到前一个
    const prev = stack[stack.length - 2];
    if (prev) {
      set((state) => {
        state.navigationStack = stack.slice(0, -1);
      });
      // 重新 navigateTo 不推栈，直接设状态
      const prevView =
        prev.type === 'paper'
          ? prev.view
          : prev.type === 'concept'
            ? 'analysis'
            : prev.type === 'section'
              ? 'writing'
              : 'graph';
      set((state) => {
        state.activeView = prevView;
      });
    }
  },
});
