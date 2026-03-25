/**
 * useAppStore — 全局共享 Store
 *
 * 合并 NavigationSlice + SelectionSlice + PanelSlice + SearchSlice + PipelineSlice + LibrarySlice。
 * 跨视图共享的低中频 UI 状态。
 *
 * 中间件链：immer → subscribeWithSelector → devtools
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  createNavigationSlice,
  type NavigationSlice,
} from './slices/navigationSlice';
import {
  createSelectionSlice,
  type SelectionSlice,
} from './slices/selectionSlice';
import { createPanelSlice, type PanelSlice } from './slices/panelSlice';
import { createSearchSlice, type SearchSlice } from './slices/searchSlice';
import {
  createPipelineSlice,
  type PipelineSlice,
} from './slices/pipelineSlice';
import {
  createLibrarySlice,
  type LibrarySlice,
} from './slices/librarySlice';
import {
  createGraphSlice,
  type GraphSlice,
} from './slices/graphSlice';
import {
  createNotesSlice,
  type NotesSlice,
} from './slices/notesSlice';

export type AppStoreState = NavigationSlice &
  SelectionSlice &
  PanelSlice &
  SearchSlice &
  PipelineSlice &
  LibrarySlice &
  GraphSlice &
  NotesSlice;

export const useAppStore = create<AppStoreState>()(
  devtools(
    subscribeWithSelector(
      immer((...args) => ({
        ...createNavigationSlice(...args),
        ...createSelectionSlice(...args),
        ...createPanelSlice(...args),
        ...createSearchSlice(...args),
        ...createPipelineSlice(...args),
        ...createLibrarySlice(...args),
        ...createGraphSlice(...args),
        ...createNotesSlice(...args),
      }))
    ),
    { name: 'AppStore', enabled: process.env.NODE_ENV === 'development' }
  )
);

/**
 * 项目切换时重置 AppStore 所有瞬态状态。
 *
 * 集中式重置，避免在 ProjectSelector 中硬编码字段列表。
 * 新增 slice 字段时只需在各 slice 初始值中定义即可，此处自动覆盖。
 */
export function resetAppStoreForProjectSwitch(): void {
  useAppStore.setState({
    // NavigationSlice
    activeView: 'library',
    previousView: null,
    navigationStack: [],
    // SelectionSlice
    selectedPaperId: null,
    selectionMode: 'explicit' as const,
    explicitIds: {},
    excludedIds: {},
    selectionAnchorId: null,
    selectedConceptId: null,
    selectedMappingId: null,
    selectedMappingPaperId: null,
    selectedMappingConceptId: null,
    selectedSectionId: null,
    selectedArticleId: null,
    focusedGraphNodeId: null,
    // SearchSlice
    globalSearchOpen: false,
    globalSearchQuery: '',
    librarySearchQuery: '',
    graphSearchQuery: '',
    // PipelineSlice
    activeTasks: {},
    taskDetailPopoverOpen: false,
    // PanelSlice — 保留面板尺寸偏好，仅重置 pin/peek/tips
    pinnedSource: null,
    pinnedChatSessionId: null,
    peekSource: null,
    contextPanelPinned: false,
    proactiveTips: [],
    // LibrarySlice
    activeGroupId: 'all',
    activeGroupType: 'smart',
    activeTagIds: [],
    libraryScrollOffset: 0,
    libraryColumnSizing: {},
    expandedRowIds: {},
    // GraphSlice
    layerVisibility: { citation: true, conceptAgree: true, conceptConflict: true, semanticNeighbor: false, notes: false },
    showConceptNodes: false,
    showNoteNodes: false,
    similarityThreshold: 0.5,
    focusDepth: '2-hop',
    layoutPaused: false,
    graphContextStatus: 'ready',
    focusedGraphNodeType: null,
    // NotesSlice
    memoQuickInputOpen: false,
    sectionQualityReports: {},
    // SelectionSlice v2.0
    selectedMemoId: null,
    selectedNoteId: null,
  });
}
