/**
 * IPC Contract — Single Source of Truth
 *
 * Every IPC channel's argument types and return types are defined here.
 * Handler registration, preload bindings, and AbyssalAPI type all derive from this.
 *
 * Naming convention: 'namespace:entity:method' (colon-separated camelCase)
 */

import type {
  Paper, Concept, ConceptFramework, ConceptDraft, ConceptMapping,
  AffectedMappings, MergeResult, SplitResult, MergeConflictResolution,
  MappingAssignment, DefinitionUpdateResult, ConceptParentUpdateResult,
  HistoryEntry, HeatmapMatrix,
  Annotation, NewAnnotation,
  ArticleOutline, SectionNode, SectionOrder, SectionContent, SectionPatch, SectionVersion,
  Memo, NewMemo, MemoFilter, NoteMeta, NewNote, NoteFilter, SaveNoteResult,
  SuggestedConcept,
  Tag, PaperCounts, DiscoverRun,
  GraphData, RAGResult, RetrievalResult, WritingContext,
  ChatMessageRecord, ChatSessionSummary, PaginationOpts,
  Recommendation, AdvisoryNotification,
  AppConfig, ProjectInfo, ProjectSetupConfig, ImportResult, SnapshotInfo,
  PDFAnnotation, CleanupPolicy, GlobalSearchResult,
} from '../models';

import type {
  Relevance, AdjudicationDecision, ExportFormat, ViewType, WorkflowType, Maturity,
} from '../enums';

import type {
  PaperFilter, GraphFilter, RAGFilter,
  WorkflowConfig, WorkspaceInfo, RecentWorkspaceEntry, CurrentWorkspaceInfo,
  PipelineProgressEvent, StreamChunkEvent, ChatResponseEvent,
  ChatContext, WindowMaximizedEvent, SectionSearchResult,
} from './index';

// ═══════════════════════════════════════════════════════════════════════
// Invoke Contract — request/response channels
// ═══════════════════════════════════════════════════════════════════════

export interface IpcContract {
  // ── db:papers ──
  'db:papers:list':                   { args: [filter?: PaperFilter];                    result: Paper[] };
  'db:papers:get':                    { args: [id: string];                              result: Paper | null };
  'db:papers:update':                 { args: [id: string, patch: Partial<Paper>];       result: void };
  'db:papers:batchUpdateRelevance':   { args: [ids: string[], rel: Relevance];           result: void };
  'db:papers:importBibtex':           { args: [content: string];                         result: ImportResult };
  'db:papers:counts':                 { args: [];                                        result: PaperCounts };
  'db:papers:delete':                 { args: [id: string];                              result: void };
  'db:papers:batchDelete':            { args: [ids: string[]];                           result: void };

  // ── db:tags ──
  'db:tags:list':                     { args: [];                                        result: Tag[] };
  'db:tags:create':                   { args: [name: string, parentId?: string];         result: Tag };
  'db:tags:update':                   { args: [id: string, patch: Partial<Tag>];         result: void };
  'db:tags:delete':                   { args: [id: string];                              result: void };

  // ── db:discoverRuns ──
  'db:discoverRuns:list':             { args: [];                                        result: DiscoverRun[] };

  // ── db:concepts ──
  'db:concepts:list':                 { args: [];                                        result: Concept[] };
  'db:concepts:getFramework':         { args: [];                                        result: ConceptFramework };
  'db:concepts:updateFramework':      { args: [fw: ConceptFramework];                    result: AffectedMappings };
  'db:concepts:search':               { args: [query: string];                           result: Concept[] };
  'db:concepts:create':               { args: [draft: ConceptDraft];                     result: Concept | null };
  'db:concepts:updateMaturity':       { args: [conceptId: string, maturity: Maturity];   result: { historyEntry: HistoryEntry } };
  'db:concepts:updateDefinition':     { args: [conceptId: string, newDef: string];       result: DefinitionUpdateResult };
  'db:concepts:updateParent':         { args: [conceptId: string, newParentId: string | null]; result: ConceptParentUpdateResult };
  'db:concepts:getHistory':           { args: [conceptId: string];                       result: HistoryEntry[] };
  'db:concepts:merge':                { args: [retainId: string, mergeId: string, resolutions: MergeConflictResolution[]]; result: MergeResult };
  'db:concepts:split':                { args: [originalId: string, c1: ConceptDraft, c2: ConceptDraft, assignments: MappingAssignment[]]; result: SplitResult };
  'db:concepts:getTimeline':          { args: [timeRange?: unknown, changeTypes?: unknown]; result: unknown[] };
  'db:concepts:getStats':             { args: [conceptId: string];                       result: ConceptStats };
  'db:concepts:getMatrix':            { args: [conceptIds?: string[], filters?: unknown]; result: HeatmapMatrix };

  // ── db:memos ──
  'db:memos:list':                    { args: [filter?: MemoFilter];                     result: Memo[] };
  'db:memos:get':                     { args: [memoId: string];                          result: Memo };
  'db:memos:create':                  { args: [memo: NewMemo];                           result: Memo };
  'db:memos:update':                  { args: [memoId: string, patch: Partial<Memo>];    result: void };
  'db:memos:delete':                  { args: [memoId: string];                          result: void };
  'db:memos:upgradeToNote':           { args: [memoId: string];                          result: { noteId: string } };
  'db:memos:upgradeToConcept':        { args: [memoId: string, draft: ConceptDraft];     result: void };
  'db:memos:getByEntity':             { args: [entityType: string, entityId: string];    result: Memo[] };

  // ── db:notes ──
  'db:notes:list':                    { args: [filter?: NoteFilter];                     result: NoteMeta[] };
  'db:notes:get':                     { args: [noteId: string];                          result: NoteMeta | null };
  'db:notes:create':                  { args: [note: NewNote];                           result: { noteId: string; filePath: string } };
  'db:notes:updateMeta':              { args: [noteId: string, patch: Partial<NoteMeta>]; result: NoteMeta };
  'db:notes:delete':                  { args: [noteId: string];                          result: void };
  'db:notes:upgradeToConcept':        { args: [noteId: string, draft: ConceptDraft];     result: void };
  'db:notes:onFileChanged':           { args: [noteId: string];                          result: void };

  // ── db:suggestedConcepts ──
  'db:suggestedConcepts:list':        { args: [];                                        result: SuggestedConcept[] };
  'db:suggestedConcepts:accept':      { args: [suggestedId: string, draft: ConceptDraft]; result: Concept };
  'db:suggestedConcepts:dismiss':     { args: [suggestedId: string];                     result: void };
  'db:suggestedConcepts:restore':     { args: [suggestedId: string];                     result: void };
  'db:suggestedConcepts:getStats':    { args: [];                                        result: SuggestedConceptsStats };

  // ── db:mappings ──
  'db:mappings:getForPaper':          { args: [paperId: string];                         result: ConceptMapping[] };
  'db:mappings:getForConcept':        { args: [conceptId: string];                       result: ConceptMapping[] };
  'db:mappings:adjudicate':           { args: [mappingId: string, decision: AdjudicationDecision, revised?: Partial<ConceptMapping>]; result: void };
  'db:mappings:getHeatmapData':       { args: [];                                        result: HeatmapMatrix };

  // ── db:annotations ──
  'db:annotations:listForPaper':      { args: [paperId: string];                         result: Annotation[] };
  'db:annotations:create':            { args: [annotation: NewAnnotation];               result: Annotation };
  'db:annotations:update':            { args: [id: string, patch: Partial<Annotation>];  result: void };
  'db:annotations:delete':            { args: [id: string];                              result: void };

  // ── db:articles ──
  'db:articles:listOutlines':         { args: [];                                        result: ArticleOutline[] };
  'db:articles:create':               { args: [title: string];                           result: ArticleOutline };
  'db:articles:update':               { args: [articleId: string, patch: Partial<ArticleOutline>]; result: void };
  'db:articles:getOutline':           { args: [articleId: string];                       result: ArticleOutline };
  'db:articles:updateOutlineOrder':   { args: [articleId: string, order: SectionOrder[]]; result: void };
  'db:articles:getSection':           { args: [sectionId: string];                       result: SectionContent };
  'db:articles:updateSection':        { args: [sectionId: string, patch: SectionPatch];  result: void };
  'db:articles:getSectionVersions':   { args: [sectionId: string];                       result: SectionVersion[] };
  'db:articles:search':               { args: [query: string];                           result: SectionSearchResult[] };
  'db:sections:create':               { args: [articleId: string, parentId: string | null, sortIndex: number, title?: string]; result: SectionNode };
  'db:sections:delete':               { args: [sectionId: string];                       result: void };

  // ── db:relations ──
  'db:relations:getGraph':            { args: [filter?: GraphFilter];                    result: GraphData };
  'db:relations:getNeighborhood':     { args: [nodeId: string, depth: number, layers?: import('../models').LayerVisibility]; result: GraphData };

  // ── db:chat ──
  'db:chat:saveMessage':              { args: [record: ChatMessageRecord];               result: void };
  'db:chat:getHistory':               { args: [contextKey: string, opts?: PaginationOpts]; result: ChatMessageRecord[] };
  'db:chat:deleteSession':            { args: [contextKey: string];                      result: void };
  'db:chat:listSessions':             { args: [];                                        result: ChatSessionSummary[] };

  // ── search ──
  'search:semanticScholar':           { args: [query: string, limit?: number, yearRange?: unknown]; result: unknown[] };
  'search:openalex':                  { args: [concepts: string[], limit?: number, yearRange?: unknown]; result: unknown[] };
  'search:arxiv':                     { args: [query: string, limit?: number, categories?: string[]]; result: unknown[] };
  'search:paperDetails':              { args: [identifier: string];                      result: unknown };
  'search:citations':                 { args: [identifier: string, direction: 'references' | 'citations', limit?: number]; result: unknown[] };
  'search:related':                   { args: [identifier: string, limit?: number];      result: unknown[] };
  'search:byAuthor':                  { args: [authorName: string, limit?: number];      result: unknown[] };

  // ── rag ──
  'rag:search':                       { args: [query: string, filter?: RAGFilter];       result: RAGResult[] };
  'rag:searchWithReport':             { args: [query: string, filter?: RAGFilter];       result: RetrievalResult };
  'rag:getWritingContext':            { args: [sectionId: string];                       result: WritingContext };

  // ── pipeline ──
  'pipeline:start':                   { args: [workflow: WorkflowType, config?: WorkflowConfig]; result: string };
  'pipeline:cancel':                  { args: [taskId: string];                          result: void };

  // ── chat ──
  'chat:send':                        { args: [message: string, context?: ChatContext];  result: string };

  // ── fs ──
  'fs:openPDF':                       { args: [paperId: string];                         result: { path: string; buffer: ArrayBuffer } };
  'fs:savePDFAnnotations':            { args: [paperId: string, annotations: PDFAnnotation[]]; result: void };
  'fs:exportArticle':                 { args: [articleId: string, format: ExportFormat];  result: string };
  'fs:importFiles':                   { args: [paths: string[]];                         result: ImportResult };
  'fs:createSnapshot':                { args: [name: string];                            result: SnapshotInfo };
  'fs:restoreSnapshot':               { args: [snapshotId: string];                      result: void };
  'fs:listSnapshots':                 { args: [];                                        result: SnapshotInfo[] };
  'fs:cleanupSnapshots':              { args: [policy: CleanupPolicy];                   result: void };
  'fs:readNoteFile':                  { args: [noteId: string];                          result: string };
  'fs:saveNoteFile':                  { args: [noteId: string, content: string];         result: SaveNoteResult };

  // ── advisory ──
  'advisory:getRecommendations':      { args: [];                                        result: Recommendation[] };
  'advisory:execute':                 { args: [id: string];                              result: string };
  'advisory:getNotifications':        { args: [];                                        result: AdvisoryNotification[] };

  // ── app ──
  'app:getConfig':                    { args: [];                                        result: AppConfig };
  'app:updateConfig':                 { args: [patch: Partial<AppConfig>];               result: void };
  'app:getProjectInfo':               { args: [];                                        result: ProjectInfo };
  'app:switchProject':                { args: [projectPath: string];                     result: void };
  'app:listProjects':                 { args: [];                                        result: ProjectInfo[] };
  'app:createProject':                { args: [config: ProjectSetupConfig];              result: ProjectInfo };
  'app:globalSearch':                 { args: [query: string];                           result: GlobalSearchResult[] };

  // ── app:window ──
  'app:window:minimize':              { args: [];                                        result: void };
  'app:window:toggleMaximize':        { args: [];                                        result: boolean };
  'app:window:close':                 { args: [];                                        result: void };
  'app:window:popOut':                { args: [viewType: ViewType, entityId?: string];   result: void };
  'app:window:list':                  { args: [];                                        result: unknown[] };

  // ── workspace ──
  'workspace:create':                 { args: [opts: { rootDir: string; name?: string; description?: string }]; result: WorkspaceInfo };
  'workspace:openDialog':             { args: [];                                        result: string | null };
  'workspace:listRecent':             { args: [];                                        result: RecentWorkspaceEntry[] };
  'workspace:getCurrent':             { args: [];                                        result: CurrentWorkspaceInfo | null };
  'workspace:switch':                 { args: [workspacePath: string];                   result: void };
  'workspace:removeRecent':           { args: [workspacePath: string];                   result: void };
  'workspace:togglePin':              { args: [workspacePath: string];                   result: boolean };
}

// ═══════════════════════════════════════════════════════════════════════
// Event Contract — main → renderer push channels
// ═══════════════════════════════════════════════════════════════════════

export interface IpcEventContract {
  'pipeline:progress$event':            PipelineProgressEvent;
  'pipeline:streamChunk$event':         StreamChunkEvent;
  'pipeline:workflow-complete$event':   { workflow: WorkflowType; taskId: string };
  'pipeline:section-quality$event':     { sectionId: string; coverage: string; gaps: string[] };
  'chat:response$event':               ChatResponseEvent;
  'app:window:maximized$event':         WindowMaximizedEvent;
  'advisory:notifications-updated$event': AdvisoryNotification[];
  'workspace:switched$event':           { rootDir: string; name: string };
  // Push manager channels
  'push:workflow-progress':             unknown;
  'push:agent-stream':                  unknown;
  'push:db-changed':                    { tables: string[]; operation: string };
  'push:notification':                  { type: string; title: string; message: string };
  'push:advisory-suggestions':          unknown[];
  'push:memo-created':                  { memoId: string };
  'push:note-indexed':                  { noteId: string; chunkCount: number };
}

// ═══════════════════════════════════════════════════════════════════════
// Fire-and-forget Contract — renderer → main (no response)
// ═══════════════════════════════════════════════════════════════════════

export interface IpcFireAndForgetContract {
  'reader:pageChanged': { args: [paperId: string, page: number] };
}

// ═══════════════════════════════════════════════════════════════════════
// Utility Types
// ═══════════════════════════════════════════════════════════════════════

/** All invoke channel names */
export type IpcChannel = keyof IpcContract;

/** Extract argument types for a channel */
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];

/** Extract result type for a channel */
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result'];

/** All event channel names */
export type IpcEventChannel = keyof IpcEventContract;

/** Extract event payload type */
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C];

/** All fire-and-forget channel names */
export type IpcFireAndForgetChannel = keyof IpcFireAndForgetContract;

// ═══════════════════════════════════════════════════════════════════════
// Extra model types used in contract
// ═══════════════════════════════════════════════════════════════════════

export interface ConceptStats {
  conceptId: string;
  mappingCount: number;
  paperCount: number;
}

export interface SuggestedConceptsStats {
  pendingCount: number;
  adoptedCount: number;
  dismissedCount: number;
}
