/**
 * PanelSlice — 面板状态
 *
 * ContextPanel、Library Sidebar、Reader 缩略图/标注列表的开合状态，
 * 以及 ContextPanel 的尺寸偏好。
 *
 * ContextPanel 尺寸使用百分比（react-resizable-panels 原生模式）。
 *
 * §2.4 钉住/偷看机制字段
 * §3.5 ProactiveTips 字段
 */

import type { StateCreator } from 'zustand';
import type { NavigationSlice } from './navigationSlice';
import type { SelectionSlice } from './selectionSlice';
import type { SearchSlice } from './searchSlice';
import type { PipelineSlice } from './pipelineSlice';
import type { LibrarySlice } from './librarySlice';
import type { GraphSlice } from './graphSlice';
import type { NotesSlice } from './notesSlice';
import type { ContextSource, ProactiveTip } from '../../../../shared-types/models';

export interface PanelSlice {
  // ── ContextPanel（百分比制）──
  contextPanelOpen: boolean;
  contextPanelSize: number;       // 当前百分比 (0–40)
  contextPanelLastSize: number;   // 折叠前记忆的百分比
  contextPanelPinned: boolean;

  // ── §2.4 钉住/偷看机制 ──
  pinnedSource: ContextSource | null;
  peekSource: ContextSource | null;

  // ── §3.5 AI 主动提示 ──
  proactiveTips: ProactiveTip[];

  // ── Library Sidebar ──
  librarySidebarOpen: boolean;

  // ── Reader panels ──
  readerThumbsOpen: boolean;
  readerAnnotationListOpen: boolean;

  // ── Actions ──
  toggleContextPanel: () => void;
  setContextPanelSize: (size: number) => void;
  setContextPanelLastSize: (size: number) => void;

  /** §2.4 钉住/取消钉住 */
  pinContextPanel: (source: ContextSource) => void;
  unpinContextPanel: () => void;
  toggleContextPanelPinned: () => void;

  /** §2.4 偷看 */
  setPeekSource: (source: ContextSource | null) => void;

  /** §3.5 ProactiveTips */
  setProactiveTips: (tips: ProactiveTip[]) => void;
  removeProactiveTip: (tipId: string) => void;

  toggleLibrarySidebar: () => void;
  toggleReaderThumbs: () => void;
  toggleReaderAnnotationList: () => void;
}

export const createPanelSlice: StateCreator<
  NavigationSlice & SelectionSlice & PanelSlice & SearchSlice & PipelineSlice & LibrarySlice & GraphSlice & NotesSlice,
  [['zustand/immer', never]],
  [],
  PanelSlice
> = (set) => ({
  // ── ContextPanel 初始值 ──
  contextPanelOpen: true,
  contextPanelSize: 28,         // §2.2 defaultSize 28%
  contextPanelLastSize: 28,
  contextPanelPinned: false,

  // ── 钉住/偷看 ──
  pinnedSource: null,
  peekSource: null,

  // ── ProactiveTips ──
  proactiveTips: [],

  // ── Library Sidebar ──
  librarySidebarOpen: true,

  // ── Reader panels ──
  readerThumbsOpen: true,
  readerAnnotationListOpen: true,

  // ── Actions ──
  toggleContextPanel: () =>
    set((state) => {
      if (state.contextPanelOpen) {
        // 折叠：记忆当前尺寸
        state.contextPanelLastSize = state.contextPanelSize;
        state.contextPanelSize = 0;
      } else {
        // 展开：恢复上次尺寸
        state.contextPanelSize = state.contextPanelLastSize || 28;
      }
      state.contextPanelOpen = !state.contextPanelOpen;
    }),

  setContextPanelSize: (size) =>
    set((state) => {
      state.contextPanelSize = size;
      if (size > 0) {
        state.contextPanelOpen = true;
      }
    }),

  setContextPanelLastSize: (size) =>
    set((state) => {
      state.contextPanelLastSize = size;
    }),

  pinContextPanel: (source: ContextSource) =>
    set((state) => {
      state.contextPanelPinned = true;
      state.pinnedSource = source;
      state.peekSource = null;
    }),

  unpinContextPanel: () =>
    set((state) => {
      state.contextPanelPinned = false;
      state.pinnedSource = null;
      state.peekSource = null;
    }),

  toggleContextPanelPinned: () =>
    set((state) => {
      state.contextPanelPinned = !state.contextPanelPinned;
      if (!state.contextPanelPinned) {
        state.pinnedSource = null;
        state.peekSource = null;
      }
    }),

  setPeekSource: (source) =>
    set((state) => {
      state.peekSource = source;
    }),

  setProactiveTips: (tips) =>
    set((state) => {
      state.proactiveTips = tips;
    }),

  removeProactiveTip: (tipId) =>
    set((state) => {
      state.proactiveTips = state.proactiveTips.filter((t) => t.id !== tipId);
    }),

  toggleLibrarySidebar: () =>
    set((state) => {
      state.librarySidebarOpen = !state.librarySidebarOpen;
    }),

  toggleReaderThumbs: () =>
    set((state) => {
      state.readerThumbsOpen = !state.readerThumbsOpen;
    }),

  toggleReaderAnnotationList: () =>
    set((state) => {
      state.readerAnnotationListOpen = !state.readerAnnotationListOpen;
    }),
});
