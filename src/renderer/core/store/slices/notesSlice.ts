/**
 * NotesSlice — v2.0 笔记系统 UI 状态
 *
 * - memoQuickInputOpen: 全局碎片笔记快速输入浮层开关
 * - sectionQualityReports: 由 pipeline:section-quality 事件推送
 */

import type { StateCreator } from 'zustand';
import type { NavigationSlice } from './navigationSlice';
import type { SelectionSlice } from './selectionSlice';
import type { PanelSlice } from './panelSlice';
import type { SearchSlice } from './searchSlice';
import type { PipelineSlice } from './pipelineSlice';
import type { LibrarySlice } from './librarySlice';
import type { GraphSlice } from './graphSlice';
import type { SectionQualityReport } from '../../../../shared-types/models';

export interface NotesSlice {
  /** 全局 Memo 快速输入浮层是否打开 */
  memoQuickInputOpen: boolean;
  /** Section → QualityReport 映射（由 pipeline 事件推送） */
  sectionQualityReports: Record<string, SectionQualityReport>;
  /** 项目创建向导是否打开 */
  projectWizardOpen: boolean;

  setMemoQuickInputOpen(open: boolean): void;
  setSectionQualityReport(sectionId: string, report: SectionQualityReport): void;
  clearSectionQualityReports(): void;
  setProjectWizardOpen(open: boolean): void;
}

type FullStore =
  & NavigationSlice
  & SelectionSlice
  & PanelSlice
  & SearchSlice
  & PipelineSlice
  & LibrarySlice
  & GraphSlice
  & NotesSlice;

export const createNotesSlice: StateCreator<
  FullStore,
  [['zustand/immer', never]],
  [],
  NotesSlice
> = (set) => ({
  memoQuickInputOpen: false,
  sectionQualityReports: {},
  projectWizardOpen: false,

  setMemoQuickInputOpen(open: boolean) {
    set((state) => {
      state.memoQuickInputOpen = open;
    });
  },

  setSectionQualityReport(sectionId: string, report: SectionQualityReport) {
    set((state) => {
      state.sectionQualityReports[sectionId] = report;
    });
  },

  clearSectionQualityReports() {
    set((state) => {
      state.sectionQualityReports = {};
    });
  },

  setProjectWizardOpen(open: boolean) {
    set((state) => {
      state.projectWizardOpen = open;
    });
  },
});
