/**
 * PipelineSlice — 管线 UI 状态
 *
 * 活跃任务的 UI 表示与详情弹层状态。
 * activeTasks 使用 Record（非 Map）以确保 immer 兼容。
 */

import type { StateCreator } from 'zustand';
import type { TaskUIState } from '../../../../shared-types/models';
import type { PipelineProgressEvent } from '../../../../shared-types/ipc';
import type { NavigationSlice } from './navigationSlice';
import type { SelectionSlice } from './selectionSlice';
import type { PanelSlice } from './panelSlice';
import type { SearchSlice } from './searchSlice';
import type { LibrarySlice } from './librarySlice';
import type { GraphSlice } from './graphSlice';
import type { NotesSlice } from './notesSlice';

export interface PipelineSlice {
  activeTasks: Record<string, TaskUIState>;
  taskDetailPopoverOpen: boolean;

  updateTask: (event: PipelineProgressEvent) => void;
  removeTask: (taskId: string) => void;
  toggleTaskDetailPopover: () => void;
}

export const createPipelineSlice: StateCreator<
  NavigationSlice & SelectionSlice & PanelSlice & SearchSlice & PipelineSlice & LibrarySlice & GraphSlice & NotesSlice,
  [['zustand/immer', never]],
  [],
  PipelineSlice
> = (set) => ({
  activeTasks: {},
  taskDetailPopoverOpen: false,

  updateTask: (event) =>
    set((state) => {
      state.activeTasks[event.taskId] = {
        taskId: event.taskId,
        workflow: event.workflow,
        status: event.status,
        currentStep: event.currentStep,
        progress: event.progress,
      };
    }),

  removeTask: (taskId) =>
    set((state) => {
      delete state.activeTasks[taskId];
    }),

  toggleTaskDetailPopover: () =>
    set((state) => {
      state.taskDetailPopoverOpen = !state.taskDetailPopoverOpen;
    }),
});
