/**
 * PipelineSlice — 管线 UI 状态
 *
 * activeTasks: 运行中的任务（终态后延迟清除）
 * taskHistory: 已完成/失败/取消的任务历史（持久保留直到用户清除）
 * taskPanelOpen: 任务面板展开状态
 *
 * activeTasks 使用 Record（非 Map）以确保 immer 兼容。
 */

import type { StateCreator } from 'zustand';
import type { TaskUIState, TaskHistoryEntry } from '../../../../shared-types/models';
import type { PipelineProgressEvent } from '../../../../shared-types/ipc';
import type { NavigationSlice } from './navigationSlice';
import type { SelectionSlice } from './selectionSlice';
import type { PanelSlice } from './panelSlice';
import type { SearchSlice } from './searchSlice';
import type { LibrarySlice } from './librarySlice';
import type { GraphSlice } from './graphSlice';
import type { NotesSlice } from './notesSlice';

const MAX_HISTORY = 50;

export interface PipelineSlice {
  activeTasks: Record<string, TaskUIState>;
  taskHistory: TaskHistoryEntry[];
  taskPanelOpen: boolean;
  taskDetailPopoverOpen: boolean;
  selectedTaskId: string | null;
  taskPanelHeight: number;

  updateTask: (event: PipelineProgressEvent) => void;
  removeTask: (taskId: string) => void;
  pushTaskHistory: (entry: TaskHistoryEntry) => void;
  clearTaskHistory: () => void;
  removeHistoryTask: (taskId: string) => void;
  toggleTaskPanel: () => void;
  toggleTaskDetailPopover: () => void;
  setSelectedTask: (taskId: string | null) => void;
  setTaskPanelHeight: (height: number) => void;
}

export const createPipelineSlice: StateCreator<
  NavigationSlice & SelectionSlice & PanelSlice & SearchSlice & PipelineSlice & LibrarySlice & GraphSlice & NotesSlice,
  [['zustand/immer', never]],
  [],
  PipelineSlice
> = (set) => ({
  activeTasks: {},
  taskHistory: [],
  taskPanelOpen: false,
  taskDetailPopoverOpen: false,
  selectedTaskId: null,
  taskPanelHeight: 200,

  updateTask: (event) =>
    set((state) => {
      const existing = state.activeTasks[event.taskId];
      // Guard: don't allow a stale 'running' event (e.g. from throttle trailing edge)
      // to overwrite a terminal status that has already been applied.
      if (
        existing &&
        event.status === 'running' &&
        (existing.status === 'completed' || existing.status === 'partial' || existing.status === 'failed' || existing.status === 'cancelled')
      ) {
        return;
      }
      state.activeTasks[event.taskId] = {
        taskId: event.taskId,
        workflow: event.workflow,
        status: event.status,
        currentStep: event.currentStep,
        progress: event.progress,
        ...(event.substeps ? { substeps: event.substeps } : {}),
      };
    }),

  removeTask: (taskId) =>
    set((state) => {
      delete state.activeTasks[taskId];
    }),

  pushTaskHistory: (entry) =>
    set((state) => {
      // Deduplicate by taskId
      const idx = state.taskHistory.findIndex((h) => h.taskId === entry.taskId);
      if (idx >= 0) state.taskHistory.splice(idx, 1);
      state.taskHistory.unshift(entry);
      if (state.taskHistory.length > MAX_HISTORY) {
        state.taskHistory.length = MAX_HISTORY;
      }
    }),

  clearTaskHistory: () =>
    set((state) => {
      state.taskHistory = [];
    }),

  removeHistoryTask: (taskId) =>
    set((state) => {
      state.taskHistory = state.taskHistory.filter((h) => h.taskId !== taskId);
      if (state.selectedTaskId === taskId) state.selectedTaskId = null;
    }),

  toggleTaskPanel: () =>
    set((state) => {
      state.taskPanelOpen = !state.taskPanelOpen;
    }),

  toggleTaskDetailPopover: () =>
    set((state) => {
      state.taskDetailPopoverOpen = !state.taskDetailPopoverOpen;
    }),

  setSelectedTask: (taskId) =>
    set((state) => {
      state.selectedTaskId = state.selectedTaskId === taskId ? null : taskId;
    }),

  setTaskPanelHeight: (height) =>
    set((state) => {
      state.taskPanelHeight = Math.max(100, Math.min(500, height));
    }),
});
