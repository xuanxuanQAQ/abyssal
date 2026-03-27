/**
 * Electron preload script — contextBridge security layer.
 *
 * Exposes `window.abyssal` API to the renderer process.
 * Uses typed `createInvoker` pattern derived from IpcContract.
 *
 * Security constraints:
 * - Renderer cannot access ipcRenderer directly
 * - Each method is a thin function wrapper — no object exposure
 * - contextBridge uses Structured Clone — no functions, class instances, Symbols
 *
 * Envelope protocol: handlers return { ok, data?, error? }.
 * Preload unwraps: on success returns data, on failure throws Error.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { UnsubscribeFn } from '../shared-types/ipc';
import type { IpcChannel, IpcArgs, IpcResult } from '../shared-types/ipc/contract';

// ─── Helpers ───

/**
 * Invoke an IPC channel and unwrap the { ok, data, error } envelope.
 * Throws on error so the renderer gets a proper exception.
 */
async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args);
  // Support both wrapped (new handlers) and raw (legacy handlers) responses
  if (result && typeof result === 'object' && 'ok' in result) {
    if (!result.ok) {
      const err = new Error(result.error?.message ?? 'Unknown IPC error');
      (err as unknown as Record<string, unknown>)['code'] = result.error?.code;
      (err as unknown as Record<string, unknown>)['recoverable'] = result.error?.recoverable;
      throw err;
    }
    return result.data as T;
  }
  // Raw return (legacy handlers without wrapHandler)
  return result as T;
}

/**
 * Create a typed invoker function for a specific IPC channel.
 * The returned function forwards arguments and unwraps the envelope.
 */
function createInvoker<C extends IpcChannel>(channel: C) {
  return (...args: IpcArgs<C>): Promise<IpcResult<C>> =>
    invoke(channel, ...args);
}

/**
 * Create an event listener registration function.
 * Returns an unsubscribe function for cleanup in component unmount.
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

// ─── API Definition ───

const abyssalAPI = {
  // ═══ db namespace ═══
  db: {
    papers: {
      list:                 createInvoker('db:papers:list'),
      get:                  createInvoker('db:papers:get'),
      update:               createInvoker('db:papers:update'),
      batchUpdateRelevance: createInvoker('db:papers:batchUpdateRelevance'),
      importBibtex:         createInvoker('db:papers:importBibtex'),
      getCounts:            createInvoker('db:papers:counts'),
      delete:               createInvoker('db:papers:delete'),
      batchDelete:          createInvoker('db:papers:batchDelete'),
    },

    tags: {
      list:   createInvoker('db:tags:list'),
      create: createInvoker('db:tags:create'),
      update: createInvoker('db:tags:update'),
      delete: createInvoker('db:tags:delete'),
    },

    discoverRuns: {
      list: createInvoker('db:discoverRuns:list'),
    },

    concepts: {
      list:             createInvoker('db:concepts:list'),
      getFramework:     createInvoker('db:concepts:getFramework'),
      updateFramework:  createInvoker('db:concepts:updateFramework'),
      merge:            createInvoker('db:concepts:merge'),
      split:            createInvoker('db:concepts:split'),
      search:           createInvoker('db:concepts:search'),
      create:           createInvoker('db:concepts:create'),
      updateMaturity:   createInvoker('db:concepts:updateMaturity'),
      updateDefinition: createInvoker('db:concepts:updateDefinition'),
      updateParent:     createInvoker('db:concepts:updateParent'),
      getHistory:       createInvoker('db:concepts:getHistory'),
      getTimeline:      createInvoker('db:concepts:getTimeline'),
      getStats:         createInvoker('db:concepts:getStats'),
      getMatrix:        createInvoker('db:concepts:getMatrix'),
    },

    memos: {
      list:             createInvoker('db:memos:list'),
      get:              createInvoker('db:memos:get'),
      create:           createInvoker('db:memos:create'),
      update:           createInvoker('db:memos:update'),
      delete:           createInvoker('db:memos:delete'),
      upgradeToNote:    createInvoker('db:memos:upgradeToNote'),
      upgradeToConcept: createInvoker('db:memos:upgradeToConcept'),
      getByEntity:      createInvoker('db:memos:getByEntity'),
    },

    notes: {
      list:             createInvoker('db:notes:list'),
      get:              createInvoker('db:notes:get'),
      create:           createInvoker('db:notes:create'),
      updateMeta:       createInvoker('db:notes:updateMeta'),
      delete:           createInvoker('db:notes:delete'),
      upgradeToConcept: createInvoker('db:notes:upgradeToConcept'),
      onFileChanged:    createInvoker('db:notes:onFileChanged'),
    },

    suggestedConcepts: {
      list:    createInvoker('db:suggestedConcepts:list'),
      accept:  createInvoker('db:suggestedConcepts:accept'),
      dismiss: createInvoker('db:suggestedConcepts:dismiss'),
      restore: createInvoker('db:suggestedConcepts:restore'),
      getStats: createInvoker('db:suggestedConcepts:getStats'),
    },

    mappings: {
      getForPaper:   createInvoker('db:mappings:getForPaper'),
      getForConcept: createInvoker('db:mappings:getForConcept'),
      adjudicate:    createInvoker('db:mappings:adjudicate'),
      getHeatmapData: createInvoker('db:mappings:getHeatmapData'),
    },

    annotations: {
      listForPaper: createInvoker('db:annotations:listForPaper'),
      create:       createInvoker('db:annotations:create'),
      update:       createInvoker('db:annotations:update'),
      delete:       createInvoker('db:annotations:delete'),
    },

    articles: {
      listOutlines:       createInvoker('db:articles:listOutlines'),
      create:             createInvoker('db:articles:create'),
      update:             createInvoker('db:articles:update'),
      getOutline:         createInvoker('db:articles:getOutline'),
      updateOutlineOrder: createInvoker('db:articles:updateOutlineOrder'),
      getSection:         createInvoker('db:articles:getSection'),
      updateSection:      createInvoker('db:articles:updateSection'),
      getSectionVersions: createInvoker('db:articles:getSectionVersions'),
      createSection:      createInvoker('db:sections:create'),
      deleteSection:      createInvoker('db:sections:delete'),
      search:             createInvoker('db:articles:search'),
    },

    relations: {
      getGraph:        createInvoker('db:relations:getGraph'),
      getNeighborhood: createInvoker('db:relations:getNeighborhood'),
    },

    chat: {
      saveMessage:   createInvoker('db:chat:saveMessage'),
      getHistory:    createInvoker('db:chat:getHistory'),
      deleteSession: createInvoker('db:chat:deleteSession'),
      listSessions:  createInvoker('db:chat:listSessions'),
    },
  },

  // ═══ search namespace ═══
  search: {
    semanticScholar: createInvoker('search:semanticScholar'),
    openAlex:        createInvoker('search:openalex'),
    arxiv:           createInvoker('search:arxiv'),
    paperDetails:    createInvoker('search:paperDetails'),
    citations:       createInvoker('search:citations'),
    related:         createInvoker('search:related'),
    byAuthor:        createInvoker('search:byAuthor'),
  },

  // ═══ rag namespace ═══
  rag: {
    search:          createInvoker('rag:search'),
    searchWithReport: createInvoker('rag:searchWithReport'),
    getWritingContext: createInvoker('rag:getWritingContext'),
  },

  // ═══ pipeline namespace ═══
  pipeline: {
    start:         createInvoker('pipeline:start'),
    cancel:        createInvoker('pipeline:cancel'),
    onProgress:    createEventListener('pipeline:progress$event'),
    onStreamChunk: createEventListener('pipeline:streamChunk$event'),
  },

  // ═══ chat namespace ═══
  chat: {
    send:       createInvoker('chat:send'),
    onResponse: createEventListener('chat:response$event'),
  },

  // ═══ reader namespace (fire-and-forget) ═══
  reader: {
    pageChanged: (paperId: string, page: number) =>
      ipcRenderer.send('reader:pageChanged', paperId, page),
  },

  // ═══ fs namespace ═══
  fs: {
    openPDF:            createInvoker('fs:openPDF'),
    savePDFAnnotations: createInvoker('fs:savePDFAnnotations'),
    exportArticle:      createInvoker('fs:exportArticle'),
    importFiles:        createInvoker('fs:importFiles'),
    createSnapshot:     createInvoker('fs:createSnapshot'),
    restoreSnapshot:    createInvoker('fs:restoreSnapshot'),
    listSnapshots:      createInvoker('fs:listSnapshots'),
    cleanupSnapshots:   createInvoker('fs:cleanupSnapshots'),
    readNoteFile:       createInvoker('fs:readNoteFile'),
    saveNoteFile:       createInvoker('fs:saveNoteFile'),
  },

  // ═══ advisory namespace ═══
  advisory: {
    getRecommendations:     createInvoker('advisory:getRecommendations'),
    execute:                createInvoker('advisory:execute'),
    getNotifications:       createInvoker('advisory:getNotifications'),
    onNotificationsUpdated: createEventListener('advisory:notifications-updated$event'),
  },

  // ═══ app namespace ═══
  app: {
    getConfig:      createInvoker('app:getConfig'),
    updateConfig:   createInvoker('app:updateConfig'),
    getProjectInfo: createInvoker('app:getProjectInfo'),
    switchProject:  createInvoker('app:switchProject'),
    listProjects:   createInvoker('app:listProjects'),
    createProject:  createInvoker('app:createProject'),
    globalSearch:   createInvoker('app:globalSearch'),
    onWorkflowComplete: createEventListener('pipeline:workflow-complete$event'),
    onSectionQuality:   createEventListener('pipeline:section-quality$event'),
    window: {
      minimize:        createInvoker('app:window:minimize'),
      toggleMaximize:  createInvoker('app:window:toggleMaximize'),
      close:           createInvoker('app:window:close'),
      popOut:          createInvoker('app:window:popOut'),
      onMaximizedChange: createEventListener('app:window:maximized$event'),
    },
  },

  // ═══ workspace namespace ═══
  workspace: {
    create:       createInvoker('workspace:create'),
    openDialog:   createInvoker('workspace:openDialog'),
    listRecent:   createInvoker('workspace:listRecent'),
    getCurrent:   createInvoker('workspace:getCurrent'),
    switch:       createInvoker('workspace:switch'),
    removeRecent: createInvoker('workspace:removeRecent'),
    togglePin:    createInvoker('workspace:togglePin'),
    onSwitched:   createEventListener('workspace:switched$event'),
  },

  // ═══ on namespace — event subscriptions ═══
  on: {
    workflowProgress:   createEventListener('push:workflow-progress'),
    agentStream:        createEventListener('push:agent-stream'),
    dbChanged:          createEventListener('push:db-changed'),
    notification:       createEventListener('push:notification'),
    advisorySuggestions: createEventListener('push:advisory-suggestions'),
    memoCreated:        createEventListener<{ memoId: string }>('push:memo-created'),
    noteIndexed:        createEventListener<{ noteId: string; chunkCount: number }>('push:note-indexed'),
  },
};

contextBridge.exposeInMainWorld('abyssal', abyssalAPI);
