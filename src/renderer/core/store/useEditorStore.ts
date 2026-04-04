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

interface EditorState {
  editorFocused: boolean;
  aiGenerating: boolean;
  aiGeneratingTaskId: string | null;
  unsavedChanges: boolean;
  liveArticleId: string | null;
  liveDraftId: string | null;
  liveDocumentJson: string | null;
  liveDocumentHash: string | null;

  setEditorFocused: (focused: boolean) => void;
  setAIGenerating: (generating: boolean, taskId?: string | null) => void;
  setUnsavedChanges: (unsaved: boolean) => void;
  setLiveDocumentState: (payload: {
    articleId: string;
    draftId: string;
    documentJson: JSONContent | string;
    documentHash: string;
  }) => void;
  clearLiveDocumentState: () => void;
  resetEditor: () => void;
}

export const useEditorStore = create<EditorState>()(
  devtools(
    subscribeWithSelector(
      immer((set) => ({
        editorFocused: false,
        aiGenerating: false,
        aiGeneratingTaskId: null,
        unsavedChanges: false,
        liveArticleId: null,
        liveDraftId: null,
        liveDocumentJson: null,
        liveDocumentHash: null,

        setEditorFocused: (focused) =>
          set((state) => {
            state.editorFocused = focused;
          }),

        setAIGenerating: (generating, taskId) =>
          set((state) => {
            state.aiGenerating = generating;
            state.aiGeneratingTaskId = taskId ?? null;
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

        clearLiveDocumentState: () =>
          set((state) => {
            state.liveArticleId = null;
            state.liveDraftId = null;
            state.liveDocumentJson = null;
            state.liveDocumentHash = null;
          }),

        resetEditor: () =>
          set((state) => {
            state.editorFocused = false;
            state.aiGenerating = false;
            state.aiGeneratingTaskId = null;
            state.unsavedChanges = false;
            state.liveArticleId = null;
            state.liveDraftId = null;
            state.liveDocumentJson = null;
            state.liveDocumentHash = null;
          }),
      }))
    ),
    { name: 'EditorStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
