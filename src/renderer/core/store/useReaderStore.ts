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
  | 'smartSelect'
  | null;

/** 用户在 PDF 中选取文本后自动注入聊天输入区的引用片段 */
export interface QuotedSelection {
  text: string;
  page: number;
}

/** 图片截图引用（来自 DLA 智能选取） */
export interface ImageClip {
  type: string;
  dataUrl: string;
  caption?: string;
  pageNumber: number;
  bbox: { x: number; y: number; w: number; h: number };
}

/** 扩展的选取载荷：支持文本 + 图片混合 */
export interface SelectionPayload {
  text?: string;
  images?: ImageClip[];
  sourcePages: number[];
}

interface ReaderState {
  currentPage: number;
  totalPages: number;
  zoomLevel: number;
  zoomMode: ZoomMode;
  activeAnnotationTool: AnnotationTool;
  highlightColor: HighlightColor;
  /** 当前注入聊天输入区的引用文本（由 PDF 选区自动写入，发送后清除） */
  quotedSelection: QuotedSelection | null;
  /** 扩展选取载荷（支持图片截图，由 DLA 智能选取写入） */
  selectionPayload: SelectionPayload | null;

  setCurrentPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  setZoomLevel: (level: number) => void;
  setZoomMode: (mode: ZoomMode) => void;
  setActiveAnnotationTool: (tool: AnnotationTool) => void;
  setHighlightColor: (color: HighlightColor) => void;
  setQuotedSelection: (sel: QuotedSelection | null) => void;
  setSelectionPayload: (payload: SelectionPayload | null) => void;
  resetReader: () => void;
}

const initialReaderState = {
  currentPage: 1,
  totalPages: 0,
  zoomLevel: 1.0,
  zoomMode: 'fitWidth' as ZoomMode,
  activeAnnotationTool: null as AnnotationTool,
  highlightColor: 'yellow' as HighlightColor,
  quotedSelection: null as QuotedSelection | null,
  selectionPayload: null as SelectionPayload | null,
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

        setQuotedSelection: (sel) =>
          set((state) => {
            state.quotedSelection = sel;
          }),

        setSelectionPayload: (payload) =>
          set((state) => {
            state.selectionPayload = payload;
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
