/**
 * useReaderStore — PDF 阅读独立 Store
 *
 * 高频更新隔离：PDF 滚动/缩放每秒可触发 60+ 次状态变更，
 * 独立 Store 防止污染全局 Store 的 selector 评估。
 * 配合 Reader 视图的懒加载实现代码分割。
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { HighlightColor } from '../../../shared-types/enums';

type ZoomMode = 'fitWidth' | 'fitPage' | 'custom';
/** §4.5 【Δ-1】三态标注工具模型 */
type AnnotationTool =
  | 'hand'
  | 'textHighlight'
  | 'textNote'
  | 'textConceptTag'
  | 'areaHighlight'
  | null;

interface ReaderState {
  currentPage: number;
  totalPages: number;
  zoomLevel: number;
  zoomMode: ZoomMode;
  activeAnnotationTool: AnnotationTool;
  highlightColor: HighlightColor;

  setCurrentPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  setZoomLevel: (level: number) => void;
  setZoomMode: (mode: ZoomMode) => void;
  setActiveAnnotationTool: (tool: AnnotationTool) => void;
  setHighlightColor: (color: HighlightColor) => void;
  resetReader: () => void;
}

const initialReaderState = {
  currentPage: 1,
  totalPages: 0,
  zoomLevel: 1.0,
  zoomMode: 'fitWidth' as ZoomMode,
  activeAnnotationTool: null as AnnotationTool,
  highlightColor: 'yellow' as HighlightColor,
};

export const useReaderStore = create<ReaderState>()(
  devtools(
    subscribeWithSelector(
      immer((set) => ({
        ...initialReaderState,

        setCurrentPage: (page) =>
          set((state) => {
            state.currentPage = page;
          }),

        setTotalPages: (total) =>
          set((state) => {
            state.totalPages = total;
          }),

        setZoomLevel: (level) =>
          set((state) => {
            state.zoomLevel = Math.max(0.5, Math.min(3.0, level));
            state.zoomMode = 'custom';
          }),

        setZoomMode: (mode) =>
          set((state) => {
            state.zoomMode = mode;
          }),

        setActiveAnnotationTool: (tool) =>
          set((state) => {
            state.activeAnnotationTool = tool;
          }),

        setHighlightColor: (color) =>
          set((state) => {
            state.highlightColor = color;
          }),

        resetReader: () =>
          set((state) => {
            Object.assign(state, initialReaderState);
          }),
      }))
    ),
    { name: 'ReaderStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
