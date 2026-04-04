/**
 * navigateTo — 全局导航协议实现
 *
 * 作为 useAppStore 的 action 调用，内部执行：
 * 1. 推入历史栈
 * 2. 切换视图
 * 3. 设置选中状态
 * 4. 触发 ContextPanel 联动
 */

import type { NavigationTarget } from './types';
import type { ViewType } from '../../../shared-types/enums';

const MAX_NAVIGATION_STACK = 20;

/**
 * 从 NavigationTarget 解析出目标视图
 */
export function resolveTargetView(target: NavigationTarget): ViewType {
  switch (target.type) {
    case 'paper':
      return target.view;
    case 'concept':
      return 'analysis';
    case 'section':
      return 'writing';
    case 'graph':
      return 'graph';
    case 'note':
    case 'memo':
      return 'notes';
  }
}

/**
 * navigateTo action 实现
 *
 * 由 useAppStore 内调用，接收 set/get 访问器。
 * 具体使用方式参见 store/useAppStore.ts 中的集成。
 */
export function applyNavigation(
  target: NavigationTarget,
  get: () => {
    activeView: ViewType;
    navigationStack: NavigationTarget[];
  },
  set: (
    partial: Partial<{
      activeView: ViewType;
      previousView: ViewType | null;
      navigationStack: NavigationTarget[];
      selectedPaperId: string | null;
      selectedConceptId: string | null;
      selectedSectionId: string | null;
      focusedGraphNodeId: string | null;
      selectedNoteId: string | null;
      selectedMemoId: string | null;
    }>
  ) => void
): void {
  const state = get();
  const targetView = resolveTargetView(target);

  // 1. 推入历史栈（上限 20）
  const newStack = [...state.navigationStack, target];
  if (newStack.length > MAX_NAVIGATION_STACK) {
    newStack.shift();
  }

  // 2 & 3. 切换视图 + 设置选中状态
  const partial: Parameters<typeof set>[0] = {
    activeView: targetView,
    previousView: state.activeView,
    navigationStack: newStack,
  };

  switch (target.type) {
    case 'paper':
      partial.selectedPaperId = target.id;
      break;
    case 'concept':
      partial.selectedConceptId = target.id;
      break;
    case 'section':
      partial.selectedSectionId = target.sectionId;
      break;
    case 'graph':
      partial.focusedGraphNodeId = target.focusNodeId;
      break;
    case 'note':
      partial.selectedNoteId = target.noteId;
      partial.selectedMemoId = null;
      break;
    case 'memo':
      partial.selectedMemoId = target.memoId;
      partial.selectedNoteId = null;
      break;
  }

  set(partial);
}
