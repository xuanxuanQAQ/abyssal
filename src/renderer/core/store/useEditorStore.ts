/**
 * useEditorStore — Tiptap 编辑器独立 Store
 *
 * 编辑器焦点/保存状态更新极其频繁（每次击键），
 * 独立 Store 使其与全局状态完全解耦。
 *
 * editorFocused 和 unsavedChanges 仅由 Tiptap 的
 * onFocus/onBlur/onUpdate 回调驱动。
 * 外部组件通过 useEditorStore.getState() 按需读取。
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { JSONContent } from '@tiptap/core';

export interface EditorSelectionState {
  articleId: string;
  draftId: string | null;
  sectionId: string | null;
  from: number;
  to: number;
  selectedText: string;
}

/**
 * persistedWritingTarget — 持久化写作锚点
 *
 * 不随 blur / 焦点切换而清空。
 * 仅在用户主动清除、产生新选区、或文档重排无法对齐时失效。
 */
export type WritingTargetKind = 'range' | 'caret';

export interface PersistedWritingTarget {
  kind: WritingTargetKind;
  articleId: string;
  draftId: string | null;
  sectionId: string | null;
  from: number;
  to: number;
  selectedText: string;
  anchorParagraphId: string | null;
  beforeText: string;
  afterText: string;
  capturedAt: number;
}

interface EditorState {
  editorFocused: boolean;
  unsavedChanges: boolean;
  liveArticleId: string | null;
  liveDraftId: string | null;
  liveDocumentJson: string | null;
  liveDocumentHash: string | null;
  editorSelection: EditorSelectionState | null;
  /** 持久化写作锚点，不随 blur 清除 */
  persistedWritingTarget: PersistedWritingTarget | null;
  /** Draft 模式流式文本（写作预览用） */
  draftStreamText: string | null;
  /** 当前正在执行的 draft 操作 ID（用于预览取消时 abort） */
  activeDraftOperationId: string | null;

  setEditorFocused: (focused: boolean) => void;
  setUnsavedChanges: (unsaved: boolean) => void;
  setLiveDocumentState: (payload: {
    articleId: string;
    draftId: string;
    documentJson: JSONContent | string;
    documentHash: string;
  }) => void;
  setEditorSelection: (selection: EditorSelectionState | null) => void;
  setPersistedWritingTarget: (target: PersistedWritingTarget | null) => void;
  clearPersistedWritingTarget: () => void;
  appendDraftStreamText: (chunk: string) => void;
  clearDraftStreamText: () => void;
  setActiveDraftOperationId: (id: string | null) => void;
  clearLiveDocumentState: () => void;
  resetEditor: () => void;
}

export const useEditorStore = create<EditorState>()(
  devtools(
    subscribeWithSelector(
      immer((set) => ({
        editorFocused: false,
        unsavedChanges: false,
        liveArticleId: null,
        liveDraftId: null,
        liveDocumentJson: null,
        liveDocumentHash: null,
        editorSelection: null,
        persistedWritingTarget: null,
        draftStreamText: null,
        activeDraftOperationId: null,

        setEditorFocused: (focused) =>
          set((state) => {
            state.editorFocused = focused;
          }),

        setUnsavedChanges: (unsaved) =>
          set((state) => {
            state.unsavedChanges = unsaved;
          }),

        setLiveDocumentState: ({ articleId, draftId, documentJson, documentHash }) =>
          set((state) => {
            state.liveArticleId = articleId;
            state.liveDraftId = draftId;
            state.liveDocumentJson = typeof documentJson === 'string'
              ? documentJson
              : JSON.stringify(documentJson);
            state.liveDocumentHash = documentHash;
          }),

        setEditorSelection: (selection) =>
          set((state) => {
            state.editorSelection = selection;
          }),

        setPersistedWritingTarget: (target) =>
          set((state) => {
            state.persistedWritingTarget = target;
          }),

        clearPersistedWritingTarget: () =>
          set((state) => {
            state.persistedWritingTarget = null;
          }),

        appendDraftStreamText: (chunk) =>
          set((state) => {
            state.draftStreamText = (state.draftStreamText ?? '') + chunk;
          }),

        clearDraftStreamText: () =>
          set((state) => {
            state.draftStreamText = null;
          }),

        setActiveDraftOperationId: (id) =>
          set((state) => {
            state.activeDraftOperationId = id;
          }),

        clearLiveDocumentState: () =>
          set((state) => {
            state.liveArticleId = null;
            state.liveDraftId = null;
            state.liveDocumentJson = null;
            state.liveDocumentHash = null;
            state.editorSelection = null;
            state.persistedWritingTarget = null;
            state.draftStreamText = null;
            state.activeDraftOperationId = null;
          }),

        resetEditor: () =>
          set((state) => {
            state.editorFocused = false;
            state.unsavedChanges = false;
            state.liveArticleId = null;
            state.liveDraftId = null;
            state.liveDocumentJson = null;
            state.liveDocumentHash = null;
            state.editorSelection = null;
            state.persistedWritingTarget = null;
            state.draftStreamText = null;
            state.activeDraftOperationId = null;
          }),
      }))
    ),
    { name: 'EditorStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
