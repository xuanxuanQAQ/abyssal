/**
 * PanelSlice — 面板状态
 *
 * ContextPanel、Library Sidebar、Reader 缩略图/标注列表、
 * Writing OutlineTree 的开合与尺寸。
 *
 * ContextPanel 尺寸使用百分比（react-resizable-panels 原生模式）。
 * 二级面板（LibrarySidebar/ReaderThumbs/OutlineTree）使用像素制。
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
import type { ContextSource, ProactiveTip } from '../../../../shared-types/models';

export interface PanelSlice {
  // ── ContextPanel（百分比制）──
  contextPanelOpen: boolean;
  contextPanelSize: number;       // 当前百分比 (0–40)
  contextPanelLastSize: number;   // 折叠前记忆的百分比
  contextPanelPinned: boolean;

  // ── §2.4 钉住/偷看机制 ──
  pinnedSource: ContextSource | null;
  pinnedChatSessionId: string | null;
  peekSource: ContextSource | null;

  // ── §3.5 AI 主动提示 ──
  proactiveTips: ProactiveTip[];

  // ── Library Sidebar（像素制）──
  librarySidebarOpen: boolean;
  librarySidebarWidth: number;    // 默认 230px, min 160, max 320

  // ── Reader panels ──
  readerThumbsOpen: boolean;
  readerThumbsWidth: number;      // 默认 80px, min 60, max 120
  readerAnnotationListOpen: boolean;

  // ── Writing OutlineTree（像素制）──
  outlineTreeOpen: boolean;
  outlineTreeWidth: number;       // 默认 220px, min 160, max 360

  // ── Actions ──
  toggleContextPanel: () => void;
  setContextPanelSize: (size: number) => void;
  setContextPanelLastSize: (size: number) => void;

  /** §2.4 钉住/取消钉住 */
  pinContextPanel: (source: ContextSource, chatSessionId: string | null) => void;
  unpinContextPanel: () => void;
  toggleContextPanelPinned: () => void;

  /** §2.4 偷看 */
  setPeekSource: (source: ContextSource | null) => void;

  /** §3.5 ProactiveTips */
  setProactiveTips: (tips: ProactiveTip[]) => void;
  removeProactiveTip: (tipId: string) => void;

  toggleLibrarySidebar: () => void;
  setLibrarySidebarWidth: (width: number) => void;
  toggleReaderThumbs: () => void;
  setReaderThumbsWidth: (width: number) => void;
  toggleReaderAnnotationList: () => void;
  toggleOutlineTree: () => void;
  setOutlineTreeWidth: (width: number) => void;
}

export const createPanelSlice: StateCreator<
  NavigationSlice & SelectionSlice & PanelSlice & SearchSlice & PipelineSlice & LibrarySlice & GraphSlice,
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
  pinnedChatSessionId: null,
  peekSource: null,

  // ── ProactiveTips ──
  proactiveTips: [],

  // ── Library Sidebar ──
  librarySidebarOpen: true,
  librarySidebarWidth: 230,     // §2.4

  // ── Reader panels ──
  readerThumbsOpen: true,
  readerThumbsWidth: 80,        // §2.4
  readerAnnotationListOpen: true,

  // ── Writing OutlineTree ──
  outlineTreeOpen: true,
  outlineTreeWidth: 220,        // §2.4

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

  pinContextPanel: (source, chatSessionId) =>
    set((state) => {
      state.contextPanelPinned = true;
      state.pinnedSource = source;
      state.pinnedChatSessionId = chatSessionId;
      state.peekSource = null;
    }),

  unpinContextPanel: () =>
    set((state) => {
      state.contextPanelPinned = false;
      state.pinnedSource = null;
      // pinnedChatSessionId 保留为历史记录
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

  setLibrarySidebarWidth: (width) =>
    set((state) => {
      state.librarySidebarWidth = Math.max(160, Math.min(320, width));
    }),

  toggleReaderThumbs: () =>
    set((state) => {
      state.readerThumbsOpen = !state.readerThumbsOpen;
    }),

  setReaderThumbsWidth: (width) =>
    set((state) => {
      state.readerThumbsWidth = Math.max(60, Math.min(120, width));
    }),

  toggleReaderAnnotationList: () =>
    set((state) => {
      state.readerAnnotationListOpen = !state.readerAnnotationListOpen;
    }),

  toggleOutlineTree: () =>
    set((state) => {
      state.outlineTreeOpen = !state.outlineTreeOpen;
    }),

  setOutlineTreeWidth: (width) =>
    set((state) => {
      state.outlineTreeWidth = Math.max(160, Math.min(360, width));
    }),
});
