/**
 * Electron preload 脚本
 *
 * 通过 contextBridge.exposeInMainWorld 将类型安全的 AbyssalAPI
 * 暴露给渲染进程。所有 IPC 通信必须经过此层。
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared-types/ipc';
import type { UnsubscribeFn } from '../shared-types/ipc';

/**
 * 创建事件监听注册函数
 * 返回取消订阅函数，确保组件卸载时安全移除监听器
 */
function createEventListener<T>(channel: string) {
  return (cb: (event: T) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, data: T) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const abyssalAPI = {
  db: {
    papers: {
      list: (filter?: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_PAPERS_LIST, filter),
      get: (id: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_PAPERS_GET, id),
      update: (id: string, patch: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_PAPERS_UPDATE, id, patch),
      batchUpdateRelevance: (ids: string[], rel: string) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_PAPERS_BATCH_UPDATE_RELEVANCE,
          ids,
          rel
        ),
      importBibtex: (content: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_PAPERS_IMPORT_BIBTEX, content),
      getCounts: () =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_PAPERS_COUNTS),
      delete: (id: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_PAPERS_DELETE, id),
      batchDelete: (ids: string[]) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_PAPERS_BATCH_DELETE, ids),
    },
    tags: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.DB_TAGS_LIST),
      create: (name: string, parentId?: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_TAGS_CREATE, name, parentId),
      update: (id: string, patch: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_TAGS_UPDATE, id, patch),
      delete: (id: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_TAGS_DELETE, id),
    },
    discoverRuns: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.DB_DISCOVER_RUNS_LIST),
    },
    concepts: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_LIST),
      getFramework: () =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_GET_FRAMEWORK),
      updateFramework: (fw: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_UPDATE_FRAMEWORK, fw),
      merge: (keepId: string, mergeId: string, conflictResolutions: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_MERGE, keepId, mergeId, conflictResolutions),
      resolveMergeConflicts: (decisions: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_RESOLVE_MERGE, decisions),
      split: (conceptId: string, concept1: unknown, concept2: unknown, mappingAssignments: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_SPLIT, conceptId, concept1, concept2, mappingAssignments),
      reassignMappings: (assignments: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_REASSIGN, assignments),
      search: (query: string) =>
        ipcRenderer.invoke('db:concepts:search', query),
      create: (draft: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_CREATE, draft),
      updateMaturity: (conceptId: string, maturity: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_UPDATE_MATURITY, conceptId, maturity),
      updateDefinition: (conceptId: string, newDefinition: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_UPDATE_DEFINITION, conceptId, newDefinition),
      updateParent: (conceptId: string, newParentId: string | null) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_UPDATE_PARENT, conceptId, newParentId),
      getHistory: (conceptId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CONCEPTS_GET_HISTORY, conceptId),
    },
    memos: {
      list: (filter?: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MEMOS_LIST, filter),
      get: (memoId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MEMOS_GET, memoId),
      create: (memo: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MEMOS_CREATE, memo),
      update: (memoId: string, patch: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MEMOS_UPDATE, memoId, patch),
      delete: (memoId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MEMOS_DELETE, memoId),
      upgradeToNote: (memoId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MEMOS_UPGRADE_TO_NOTE, memoId),
      upgradeToConcept: (memoId: string, draft: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MEMOS_UPGRADE_TO_CONCEPT, memoId, draft),
    },
    notes: {
      list: (filter?: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_NOTES_LIST, filter),
      get: (noteId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_NOTES_GET, noteId),
      create: (note: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_NOTES_CREATE, note),
      updateMeta: (noteId: string, patch: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_NOTES_UPDATE_META, noteId, patch),
      delete: (noteId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_NOTES_DELETE, noteId),
      upgradeToConcept: (noteId: string, draft: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_NOTES_UPGRADE_TO_CONCEPT, noteId, draft),
    },
    suggestedConcepts: {
      list: () =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_LIST),
      accept: (suggestedId: string, draft: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_ACCEPT, suggestedId, draft),
      dismiss: (suggestedId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_DISMISS, suggestedId),
      restore: (suggestedId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_RESTORE, suggestedId),
    },
    mappings: {
      getForPaper: (paperId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MAPPINGS_GET_FOR_PAPER, paperId),
      getForConcept: (conceptId: string) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_MAPPINGS_GET_FOR_CONCEPT,
          conceptId
        ),
      adjudicate: (
        mappingId: string,
        decision: string,
        revisedMapping?: unknown
      ) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_MAPPINGS_ADJUDICATE,
          mappingId,
          decision,
          revisedMapping
        ),
      getHeatmapData: () =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_MAPPINGS_GET_HEATMAP_DATA),
    },
    annotations: {
      listForPaper: (paperId: string) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_ANNOTATIONS_LIST_FOR_PAPER,
          paperId
        ),
      create: (annotation: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ANNOTATIONS_CREATE, annotation),
      update: (id: string, patch: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ANNOTATIONS_UPDATE, id, patch),
      delete: (id: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ANNOTATIONS_DELETE, id),
    },
    articles: {
      listOutlines: () =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ARTICLES_LIST_OUTLINES),
      create: (title: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ARTICLES_CREATE, title),
      update: (articleId: string, patch: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ARTICLES_UPDATE, articleId, patch),
      getOutline: (articleId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ARTICLES_GET_OUTLINE, articleId),
      updateOutlineOrder: (articleId: string, order: unknown) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_ARTICLES_UPDATE_OUTLINE_ORDER,
          articleId,
          order
        ),
      getSection: (sectionId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ARTICLES_GET_SECTION, sectionId),
      updateSection: (sectionId: string, patch: unknown) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_ARTICLES_UPDATE_SECTION,
          sectionId,
          patch
        ),
      getSectionVersions: (sectionId: string) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_ARTICLES_GET_SECTION_VERSIONS,
          sectionId
        ),
      createSection: (
        articleId: string,
        parentId: string | null,
        sortIndex: number,
        title?: string
      ) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.DB_SECTIONS_CREATE,
          articleId,
          parentId,
          sortIndex,
          title
        ),
      deleteSection: (sectionId: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_SECTIONS_DELETE, sectionId),
      search: (query: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_ARTICLES_SEARCH, query),
    },
    relations: {
      getGraph: (filter?: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_RELATIONS_GET_GRAPH, filter),
      getNeighborhood: (nodeId: string, depth: number, layers?: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_RELATIONS_GET_NEIGHBORHOOD, nodeId, depth, layers),
    },

    chat: {
      saveMessage: (record: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CHAT_SAVE_MESSAGE, record),
      getHistory: (contextKey: string, opts?: unknown) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CHAT_GET_HISTORY, contextKey, opts),
      deleteSession: (contextKey: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CHAT_DELETE_SESSION, contextKey),
      listSessions: () =>
        ipcRenderer.invoke(IPC_CHANNELS.DB_CHAT_LIST_SESSIONS),
    },
  },

  rag: {
    search: (query: string, filter?: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.RAG_SEARCH, query, filter),
    searchWithReport: (query: string, filter?: unknown) =>
      ipcRenderer.invoke('rag:searchWithReport', query, filter),
    getWritingContext: (sectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.RAG_GET_WRITING_CONTEXT, sectionId),
  },

  pipeline: {
    start: (workflow: string, config?: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_START, workflow, config),
    cancel: (taskId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_CANCEL, taskId),
    onProgress: createEventListener(IPC_CHANNELS.PIPELINE_PROGRESS_EVENT),
    onStreamChunk: createEventListener(
      IPC_CHANNELS.PIPELINE_STREAM_CHUNK_EVENT
    ),
  },

  chat: {
    send: (message: string, context?: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, message, context),
    onResponse: createEventListener(IPC_CHANNELS.CHAT_RESPONSE_EVENT),
  },

  reader: {
    /** §13.1 翻页事件推送（fire-and-forget） */
    pageChanged: (paperId: string, page: number) =>
      ipcRenderer.send(IPC_CHANNELS.READER_PAGE_CHANGED, paperId, page),
  },

  fs: {
    openPDF: (paperId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_OPEN_PDF, paperId),
    savePDFAnnotations: (paperId: string, annotations: unknown) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.FS_SAVE_PDF_ANNOTATIONS,
        paperId,
        annotations
      ),
    exportArticle: (articleId: string, format: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_EXPORT_ARTICLE, articleId, format),
    importFiles: (paths: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_IMPORT_FILES, paths),
    createSnapshot: (name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_SNAPSHOT, name),
    restoreSnapshot: (snapshotId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_RESTORE_SNAPSHOT, snapshotId),
    listSnapshots: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_LIST_SNAPSHOTS),
    cleanupSnapshots: (policy: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_CLEANUP_SNAPSHOTS, policy),
    readNoteFile: (noteId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_READ_NOTE_FILE, noteId),
    saveNoteFile: (noteId: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_SAVE_NOTE_FILE, noteId, content),
  },

  advisory: {
    getRecommendations: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ADVISORY_GET_RECOMMENDATIONS),
    execute: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ADVISORY_EXECUTE, id),
    getNotifications: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ADVISORY_GET_NOTIFICATIONS),
    onNotificationsUpdated: createEventListener(
      IPC_CHANNELS.ADVISORY_NOTIFICATIONS_UPDATED_EVENT
    ),
  },

  app: {
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_CONFIG),
    updateConfig: (patch: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_UPDATE_CONFIG, patch),
    getProjectInfo: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PROJECT_INFO),
    switchProject: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_SWITCH_PROJECT, projectPath),
    listProjects: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_LIST_PROJECTS),
    createProject: (config: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_CREATE_PROJECT, config),
    globalSearch: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GLOBAL_SEARCH, query),
    onWorkflowComplete: createEventListener(
      IPC_CHANNELS.PIPELINE_WORKFLOW_COMPLETE_EVENT
    ),
    onSectionQuality: createEventListener(
      IPC_CHANNELS.PIPELINE_SECTION_QUALITY_EVENT
    ),
    window: {
      minimize: () =>
        ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_MINIMIZE),
      toggleMaximize: () =>
        ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE),
      close: () =>
        ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_CLOSE),
      popOut: (viewType: string, entityId?: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.APP_WINDOW_POP_OUT, viewType, entityId),
      onMaximizedChange: createEventListener(
        IPC_CHANNELS.APP_WINDOW_MAXIMIZED_EVENT
      ),
    },
  },
};

contextBridge.exposeInMainWorld('abyssal', abyssalAPI);
