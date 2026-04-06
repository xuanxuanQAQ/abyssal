/**
 * Electron preload script — contextBridge security layer.
 *
 * Exposes `window.abyssal` API to the renderer process.
 * The API structure is auto-built from IPC channel name arrays,
 * following the conventions defined in shared-types/ipc/derive.ts.
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
import type { AbyssalAPI } from '../shared-types/ipc';
import type { IpcChannel } from '../shared-types/ipc/contract';

// ─── Channel Name Arrays ───
// Each entry is validated against its contract type at compile time.
// If a channel is added to IpcContract but not listed here, the
// exhaustiveness check at the bottom will produce a type error.

const INVOKE_CHANNELS = [
  // db:papers
  'db:papers:list', 'db:papers:get', 'db:papers:update',
  'db:papers:batchUpdateRelevance', 'db:papers:importBibtex',
  'db:papers:getCounts', 'db:papers:delete', 'db:papers:batchDelete', 'db:papers:resetAnalysis',
  'db:papers:resetProcess', 'db:papers:resetFulltext', 'db:papers:linkPdf',
  // db:tags
  'db:tags:list', 'db:tags:create', 'db:tags:update', 'db:tags:delete',
  // db:discoverRuns
  'db:discoverRuns:list',
  // db:concepts
  'db:concepts:list', 'db:concepts:getFramework', 'db:concepts:updateFramework',
  'db:concepts:search', 'db:concepts:create', 'db:concepts:updateMaturity',
  'db:concepts:updateDefinition', 'db:concepts:updateParent', 'db:concepts:getHistory',
  'db:concepts:merge', 'db:concepts:split', 'db:concepts:getTimeline',
  'db:concepts:getStats', 'db:concepts:getMatrix',
  // db:memos
  'db:memos:list', 'db:memos:get', 'db:memos:create', 'db:memos:update',
  'db:memos:delete', 'db:memos:upgradeToNote', 'db:memos:upgradeToConcept',
  'db:memos:getByEntity',
  // db:notes
  'db:notes:list', 'db:notes:get', 'db:notes:create', 'db:notes:updateMeta',
  'db:notes:delete', 'db:notes:upgradeToConcept',
  'db:notes:getContent', 'db:notes:saveContent',
  // db:suggestedConcepts
  'db:suggestedConcepts:list', 'db:suggestedConcepts:accept',
  'db:suggestedConcepts:dismiss', 'db:suggestedConcepts:restore',
  'db:suggestedConcepts:getStats',
  // db:mappings
  'db:mappings:getForPaper', 'db:mappings:getForConcept',
  'db:mappings:adjudicate', 'db:mappings:getHeatmapData',
  // db:annotations
  'db:annotations:listForPaper', 'db:annotations:create',
  'db:annotations:update', 'db:annotations:delete',
  // db:articles
  'db:articles:listOutlines', 'db:articles:create', 'db:articles:update',
  'db:articles:delete',
  'db:articles:getDocument', 'db:articles:saveDocument',
  'db:articles:getOutline', 'db:articles:updateOutlineOrder',
  'db:articles:getSection', 'db:articles:updateSection',
  'db:articles:getSectionVersions', 'db:articles:createSection',
  'db:articles:deleteSection', 'db:articles:search',
  'db:articles:getFullDocument', 'db:articles:saveDocumentSections',
  'db:articles:updateMetadata', 'db:articles:cleanupVersions',
  // db:drafts
  'db:drafts:listByArticle', 'db:drafts:get', 'db:drafts:create', 'db:drafts:update',
  'db:drafts:delete', 'db:drafts:getDocument', 'db:drafts:saveDocument',
  'db:drafts:getOutline', 'db:drafts:updateOutlineOrder', 'db:drafts:updateSection',
  'db:drafts:createSection', 'db:drafts:deleteSection', 'db:drafts:getVersions',
  'db:drafts:restoreVersion', 'db:drafts:createFromVersion',
  // db:assets
  'db:assets:upload', 'db:assets:list', 'db:assets:get', 'db:assets:delete',
  // db:relations
  'db:relations:getGraph', 'db:relations:getNeighborhood',
  // db:chat
  'db:chat:saveMessage', 'db:chat:getHistory',
  'db:chat:deleteSession', 'db:chat:listSessions',
  // acquire
  'acquire:fulltext', 'acquire:batch', 'acquire:status',
  'acquire:getInstitutions', 'acquire:institutionalLogin', 'acquire:sessionStatus', 'acquire:verifyCookies', 'acquire:clearSession',
  // search
  'search:semanticScholar', 'search:openAlex', 'search:arxiv',
  'search:paperDetails', 'search:citations', 'search:related', 'search:byAuthor',
  // rag
  'rag:search', 'rag:searchWithReport', 'rag:getWritingContext',
  // pipeline
  'pipeline:start', 'pipeline:cancel',
  // fs
  'fs:openPDF', 'fs:savePDFAnnotations', 'fs:exportArticle', 'fs:importFiles',
  'fs:createSnapshot', 'fs:restoreSnapshot', 'fs:listSnapshots', 'fs:cleanupSnapshots',
  'fs:selectImageFile',
  // advisory
  'advisory:getRecommendations', 'advisory:execute', 'advisory:getNotifications',
  // settings
  'settings:getAll', 'settings:updateSection', 'settings:updateApiKey',
  'settings:testApiKey', 'settings:testApiKeyDirect', 'settings:getDbStats', 'settings:getSystemInfo',
  'settings:openWorkspaceFolder', 'settings:getIndexHealth', 'settings:rebuildIntentEmbeddings',
  // app
  'app:getConfig', 'app:updateConfig', 'app:getProjectInfo', 'app:switchProject',
  'app:listProjects', 'app:createProject', 'app:globalSearch',
  // app:window
  'app:window:minimize', 'app:window:toggleMaximize', 'app:window:close',
  'app:window:popOut', 'app:window:list',
  // concept keywords & article citation helpers
  'db:concepts:updateKeywords', 'db:articles:getAllCitedPaperIds',
  // dla (Document Layout Analysis)
  'dla:analyze', 'dla:getBlocks', 'dla:getDocumentBlocks', 'dla:analyzeDocument',
  'dla:getOcrLines', 'dla:getDocumentOcrLines',
  // workspace
  'workspace:create', 'workspace:openDialog', 'workspace:listRecent',
  'workspace:getCurrent', 'workspace:switch', 'workspace:removeRecent',
  'workspace:togglePin',
  // copilot runtime
  'copilot:execute', 'copilot:abort', 'copilot:resume',
  'copilot:getOperationStatus', 'copilot:listSessions', 'copilot:getSession',
  'copilot:clearSession',
] as const satisfies readonly IpcChannel[];

/** Compile-time exhaustiveness: fails if any IpcChannel is missing above */
type _InvokeCheck = Exclude<IpcChannel, typeof INVOKE_CHANNELS[number]> extends never
  ? true : ['ERROR: missing invoke channels', Exclude<IpcChannel, typeof INVOKE_CHANNELS[number]>];
const _invokeOk: _InvokeCheck = true;

const EVENT_CHANNELS = [
  'pipeline:progress$event',
  'pipeline:streamChunk$event',
  'app:workflowComplete$event',
  'app:sectionQuality$event',
  'app:window:maximizedChange$event',
  'advisory:notificationsUpdated$event',
  'workspace:switched$event',
] as const;

const PUSH_CHANNELS = [
  'push:workflowProgress',
  'push:dbChanged',
  'push:settingsChanged',
  'push:notification',
  'push:advisorySuggestions',
  'push:memoCreated',
  'push:noteIndexed',
  'push:dbHealth',
  'push:exportProgress',
  'push:dlaPageReady',
  'push:aiCommand',
  'push:copilotEvent',
  'push:copilotSessionChanged',
] as const;

const FAF_CHANNELS = [
  'reader:pageChanged',
  'event:userAction',
  'event:suggestionResponse',
] as const;

// ─── Helpers ───

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result && typeof result === 'object' && 'ok' in result) {
    if (!result.ok) {
      const err = new Error(result.error?.message ?? 'Unknown IPC error');
      (err as unknown as Record<string, unknown>)['code'] = result.error?.code;
      (err as unknown as Record<string, unknown>)['recoverable'] = result.error?.recoverable;
      throw err;
    }
    return result.data;
  }
  // Malformed response: handler did not return the expected { ok, data } envelope.
  // This indicates a protocol violation — throw instead of silently returning raw data.
  if (result !== undefined && result !== null) {
    console.warn(`[preload] IPC channel "${channel}" returned non-envelope response`);
    throw new Error(`Malformed IPC response from channel "${channel}"`);
  }
  return result;
}

function createInvoker(channel: string) {
  return (...args: unknown[]) => invoke(channel, ...args);
}

function createEventListener(channel: string) {
  return (cb: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  };
}

// ─── Auto-builder ───

function setPath(obj: Record<string, any>, path: string[], value: unknown): void {
  let node = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    node[key] ??= {};
    node = node[key];
  }
  node[path[path.length - 1]!] = value;
}

function buildAPI(): AbyssalAPI {
  const api: Record<string, any> = {};

  // Invoke channels: 'db:papers:list' → api.db.papers.list(...)
  for (const ch of INVOKE_CHANNELS) {
    setPath(api, ch.split(':'), createInvoker(ch));
  }

  // Event channels: 'pipeline:progress$event' → api.pipeline.onProgress(cb)
  for (const ch of EVENT_CHANNELS) {
    const base = ch.replace(/\$event$/, '');
    const parts = base.split(':');
    const last = parts.pop()!;
    parts.push('on' + last.charAt(0).toUpperCase() + last.slice(1));
    setPath(api, parts, createEventListener(ch));
  }

  // Push channels: 'push:dbChanged' → api.on.dbChanged(cb)
  for (const ch of PUSH_CHANNELS) {
    const name = ch.replace(/^push:/, '');
    setPath(api, ['on', name], createEventListener(ch));
  }

  // Fire-and-forget: 'reader:pageChanged' → api.reader.pageChanged(...)
  for (const ch of FAF_CHANNELS) {
    setPath(api, ch.split(':'), (...args: unknown[]) => ipcRenderer.send(ch, ...args));
  }

  return api as AbyssalAPI;
}

// ─── Expose to renderer ───

contextBridge.exposeInMainWorld('abyssal', buildAPI());
