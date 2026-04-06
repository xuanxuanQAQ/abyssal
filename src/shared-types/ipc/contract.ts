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
  ArticleOutline, ArticleWorkspaceSummary, DraftSummary, DraftOutline, DraftPatch, DraftVersion, DraftDocumentPayload, WritingContextRequest, SectionNode, SectionOrder, SectionContent, SectionPatch, SectionVersion,
  FullDocumentContent, SectionSave, ArticleAsset, ArticleDocumentPayload,
  Memo, NewMemo, MemoFilter, NoteMeta, NewNote, NoteFilter, SaveNoteContentResult,
  SuggestedConcept,
  Tag, PaperCounts, DiscoverRun,
  GraphData, RAGResult, RetrievalResult, WritingContext,
  ChatMessageRecord, ChatSessionSummary, PaginationOpts,
  Recommendation, AdvisoryNotification,
  AppConfig, ProjectInfo, ProjectSetupConfig, ImportResult, SnapshotInfo,
  PDFAnnotation, CleanupPolicy, GlobalSearchResult,
  ConceptStats, SuggestedConceptsStats, LayerVisibility,
  SettingsData, DbStatsInfo, ApiKeyTestResult, SystemInfo,
  ArticleMetadata,
} from '../models';

import type {
  Relevance, AdjudicationDecision, ExportFormat, CitationStyle, ViewType, WorkflowType, Maturity,
} from '../enums';

import type {
  PaperFilter, GraphFilter, RAGFilter,
  PipelineProgressEvent, StreamChunkEvent, WorkflowConfig,
  ChatContext, WindowMaximizedEvent, SectionSearchResult,
  AcquireStatusInfo,
  InstitutionalSessionStatus, InstitutionListItem, InstitutionalLoginResult,
} from './index';

import type {
  WorkspaceInfo, RecentWorkspaceEntry, CurrentWorkspaceInfo,
} from '../models';

import type {
  CopilotOperationEnvelope, CopilotExecuteResult,
  CopilotSessionSummary, CopilotSessionState,
  CopilotOperationEvent, OperationStatusSnapshot,
  ResumeOperationRequest,
} from '../../copilot-runtime/types';

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
  'db:papers:getCounts':               { args: [];                                        result: PaperCounts };
  'db:papers:delete':                 { args: [id: string];                              result: void };
  'db:papers:batchDelete':            { args: [ids: string[]];                           result: void };
  'db:papers:resetAnalysis':          { args: [id: string];                              result: void };
  /** Delete text file and reset textPath only (keep PDF). */
  'db:papers:resetProcess':           { args: [id: string];                              result: void };
  /** Delete PDF + text files and reset fulltext status to not_attempted. */
  'db:papers:resetFulltext':          { args: [id: string];                              result: void };
  /** Link a local PDF file to an existing paper. If pdfPath is null, main process opens a file dialog. */
  'db:papers:linkPdf':                { args: [paperId: string, pdfPath?: string | null]; result: void };

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
  'db:concepts:updateKeywords':       { args: [conceptId: string, keywords: string[]];   result: { updated: boolean } };

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
  'db:notes:create':                  { args: [note: NewNote];                           result: { noteId: string } };
  'db:notes:updateMeta':              { args: [noteId: string, patch: Partial<NoteMeta>]; result: NoteMeta };
  'db:notes:delete':                  { args: [noteId: string];                          result: void };
  'db:notes:upgradeToConcept':        { args: [noteId: string, draft: ConceptDraft];     result: void };
  'db:notes:getContent':              { args: [noteId: string];                          result: string | null };
  'db:notes:saveContent':             { args: [noteId: string, documentJson: string];    result: SaveNoteContentResult };

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
  'db:articles:delete':               { args: [articleId: string];                       result: void };
  'db:articles:getDocument':          { args: [articleId: string];                       result: ArticleDocumentPayload };
  'db:articles:saveDocument':         { args: [articleId: string, documentJson: string, source?: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite']; result: void };
  'db:articles:getOutline':           { args: [articleId: string];                       result: ArticleOutline };
  'db:articles:updateOutlineOrder':   { args: [articleId: string, order: SectionOrder[]]; result: void };
  'db:articles:getSection':           { args: [sectionId: string];                       result: SectionContent };
  'db:articles:updateSection':        { args: [sectionId: string, patch: SectionPatch];  result: void };
  'db:articles:getSectionVersions':   { args: [sectionId: string];                       result: SectionVersion[] };
  'db:articles:search':               { args: [query: string];                           result: SectionSearchResult[] };
  'db:articles:createSection':         { args: [articleId: string, parentId: string | null, sortIndex: number, title?: string]; result: SectionNode };
  'db:articles:deleteSection':         { args: [sectionId: string];                       result: void };
  'db:articles:getFullDocument':       { args: [articleId: string];                       result: FullDocumentContent };
  'db:articles:saveDocumentSections':  { args: [articleId: string, sections: SectionSave[]]; result: void };
  'db:articles:updateMetadata':        { args: [articleId: string, metadata: ArticleMetadata]; result: void };
  'db:articles:cleanupVersions':       { args: [articleId: string, keepCount: number];     result: { deleted: number } };
  'db:articles:getAllCitedPaperIds':   { args: [];                                        result: string[] };

  // ── db:drafts ──
  'db:drafts:listByArticle':           { args: [articleId: string];                       result: DraftSummary[] };
  'db:drafts:get':                     { args: [draftId: string];                         result: DraftSummary | null };
  'db:drafts:create':                  { args: [articleId: string, seed?: Partial<DraftPatch> & { title?: string; basedOnDraftId?: string | null; source?: DraftSummary['source'] }]; result: DraftSummary };
  'db:drafts:update':                  { args: [draftId: string, patch: DraftPatch];      result: void };
  'db:drafts:delete':                  { args: [draftId: string];                         result: void };
  'db:drafts:getDocument':             { args: [draftId: string];                         result: DraftDocumentPayload };
  'db:drafts:saveDocument':            { args: [draftId: string, documentJson: string, source?: DraftVersion['source']]; result: void };
  'db:drafts:getOutline':              { args: [draftId: string];                         result: DraftOutline };
  'db:drafts:updateOutlineOrder':      { args: [draftId: string, order: SectionOrder[]];  result: void };
  'db:drafts:updateSection':           { args: [draftId: string, sectionId: string, patch: SectionPatch]; result: void };
  'db:drafts:createSection':           { args: [draftId: string, parentId: string | null, sortIndex: number, title?: string]; result: SectionNode };
  'db:drafts:deleteSection':           { args: [draftId: string, sectionId: string];      result: void };
  'db:drafts:getVersions':             { args: [draftId: string];                         result: DraftVersion[] };
  'db:drafts:restoreVersion':          { args: [draftId: string, version: number];        result: void };
  'db:drafts:createFromVersion':       { args: [draftId: string, version: number, title: string]; result: DraftSummary };

  // ── db:assets ──
  'db:assets:upload':                  { args: [articleId: string, fileName: string, sourcePath: string]; result: ArticleAsset };
  'db:assets:list':                    { args: [articleId: string];                       result: ArticleAsset[] };
  'db:assets:get':                     { args: [assetId: string];                         result: ArticleAsset | null };
  'db:assets:delete':                  { args: [assetId: string];                         result: void };

  // ── db:relations ──
  'db:relations:getGraph':            { args: [filter?: GraphFilter];                    result: GraphData };
  'db:relations:getNeighborhood':     { args: [nodeId: string, depth: number, layers?: LayerVisibility]; result: GraphData };

  // ── db:chat ──
  'db:chat:saveMessage':              { args: [record: ChatMessageRecord];               result: void };
  'db:chat:getHistory':               { args: [contextKey: string, opts?: PaginationOpts]; result: ChatMessageRecord[] };
  'db:chat:deleteSession':            { args: [contextKey: string];                      result: void };
  'db:chat:listSessions':             { args: [];                                        result: ChatSessionSummary[] };

  // ── search ──
  'search:semanticScholar':           { args: [query: string, limit?: number, yearRange?: unknown]; result: unknown[] };
  'search:openAlex':                   { args: [concepts: string[], limit?: number, yearRange?: unknown]; result: unknown[] };
  'search:arxiv':                     { args: [query: string, limit?: number, categories?: string[]]; result: unknown[] };
  'search:paperDetails':              { args: [identifier: string];                      result: unknown };
  'search:citations':                 { args: [identifier: string, direction: 'references' | 'citations', limit?: number]; result: unknown[] };
  'search:related':                   { args: [identifier: string, limit?: number];      result: unknown[] };
  'search:byAuthor':                  { args: [authorName: string, limit?: number];      result: unknown[] };

  // ── rag ──
  'rag:search':                       { args: [query: string, filter?: RAGFilter];       result: RAGResult[] };
  'rag:searchWithReport':             { args: [query: string, filter?: RAGFilter];       result: RetrievalResult };
  'rag:getWritingContext':            { args: [request: WritingContextRequest | string];  result: WritingContext };

  // ── pipeline ──
  'pipeline:start':                   { args: [workflow: WorkflowType, config?: WorkflowConfig]; result: string };
  'pipeline:cancel':                  { args: [taskId: string];                          result: boolean };

  // ── acquire ──
  'acquire:fulltext':                 { args: [paperId: string];                         result: string };
  'acquire:batch':                    { args: [paperIds: string[]];                      result: string };
  'acquire:status':                   { args: [paperId: string];                         result: AcquireStatusInfo };
  'acquire:getInstitutions':          { args: [];                                        result: InstitutionListItem[] };
  'acquire:institutionalLogin':       { args: [institutionId: string, publisher: string]; result: InstitutionalLoginResult };
  'acquire:sessionStatus':            { args: [];                                        result: InstitutionalSessionStatus };
  'acquire:verifyCookies':            { args: [publisher: string];                       result: { valid: boolean; detail: string } };
  'acquire:clearSession':             { args: [];                                        result: void };

  // ── copilot ──
  'copilot:execute':                  { args: [envelope: CopilotOperationEnvelope];      result: CopilotExecuteResult };
  'copilot:abort':                    { args: [operationId: string];                     result: void };
  'copilot:resume':                   { args: [request: ResumeOperationRequest];         result: CopilotExecuteResult };
  'copilot:getOperationStatus':       { args: [operationId: string];                     result: OperationStatusSnapshot | null };
  'copilot:listSessions':             { args: [];                                        result: CopilotSessionSummary[] };
  'copilot:getSession':               { args: [sessionId: string];                       result: CopilotSessionState | null };
  'copilot:clearSession':             { args: [sessionId: string];                       result: void };

  // ── fs ──
  'fs:openPDF':                       { args: [paperId: string];                         result: { path: string; data: Uint8Array } };
  'fs:savePDFAnnotations':            { args: [paperId: string, annotations: PDFAnnotation[]]; result: void };
  'fs:exportArticle':                 { args: [articleId: string, format: ExportFormat, citationStyle?: CitationStyle, draftId?: string];  result: string };
  'fs:importFiles':                   { args: [paths: string[]];                         result: ImportResult };
  'fs:createSnapshot':                { args: [name: string];                            result: SnapshotInfo };
  'fs:restoreSnapshot':               { args: [snapshotId: string];                      result: void };
  'fs:listSnapshots':                 { args: [];                                        result: SnapshotInfo[] };
  'fs:cleanupSnapshots':              { args: [policy: CleanupPolicy];                   result: void };

  'fs:selectImageFile':               { args: [];                                        result: { path: string; name: string } | null };

  // ── advisory ──
  'advisory:getRecommendations':      { args: [];                                        result: Recommendation[] };
  'advisory:execute':                 { args: [id: string];                              result: string };
  'advisory:getNotifications':        { args: [];                                        result: AdvisoryNotification[] };

  // ── settings ──
  'settings:getAll':                  { args: [];                                        result: SettingsData };
  'settings:updateSection':           { args: [section: string, patch: Record<string, unknown>]; result: void };
  'settings:updateApiKey':            { args: [keyName: string, value: string];          result: void };
  'settings:testApiKey':              { args: [provider: string];                        result: ApiKeyTestResult };
  'settings:testApiKeyDirect':        { args: [provider: string, apiKey: string];        result: ApiKeyTestResult };
  'settings:getDbStats':              { args: [];                                        result: DbStatsInfo };
  'settings:getSystemInfo':           { args: [];                                        result: SystemInfo };
  'settings:openWorkspaceFolder':     { args: [];                                        result: void };
  'settings:getIndexHealth':          { args: [];                                        result: Record<string, unknown> };
  'settings:rebuildIntentEmbeddings': { args: [];                                        result: void };

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

  // ── dla (Document Layout Analysis) ──
  'dla:analyze':                       { args: [paperId: string, pdfPath: string, pageIndices: number[]]; result: void };
  'dla:getBlocks':                     { args: [paperId: string, pageIndex: number]; result: import('../models').ContentBlockDTO[] | null };
  'dla:getDocumentBlocks':             { args: [paperId: string]; result: Array<{ pageIndex: number; blocks: import('../models').ContentBlockDTO[] }> };
  'dla:analyzeDocument':               { args: [paperId: string, pdfPath: string, totalPages: number]; result: void };
  'dla:getOcrLines':                   { args: [paperId: string, pageIndex: number]; result: import('../models').OcrLineDTO[] | null };
  'dla:getDocumentOcrLines':           { args: [paperId: string]; result: Array<{ pageIndex: number; lines: import('../models').OcrLineDTO[] }> };

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
  'pipeline:progress$event':              PipelineProgressEvent;
  'pipeline:streamChunk$event':           StreamChunkEvent;
  'app:workflowComplete$event':           { workflow: WorkflowType; taskId: string };
  'app:sectionQuality$event':             { sectionId: string; coverage: string; gaps: string[] };
  'app:window:maximizedChange$event':     WindowMaximizedEvent;
  'advisory:notificationsUpdated$event':  AdvisoryNotification[];
  'workspace:switched$event':             { rootDir: string; name: string };
}

// ═══════════════════════════════════════════════════════════════════════
// Push Contract — main → renderer global push channels (on.* namespace)
// ═══════════════════════════════════════════════════════════════════════

export interface IpcPushContract {
  'push:workflowProgress':    PipelineProgressEvent;
  'push:copilotEvent':        CopilotOperationEvent;
  'push:copilotSessionChanged': { sessionId: string; operationId?: string };
  'push:dbChanged':           { tables: string[]; operation: string };
  'push:settingsChanged':     { section: string; keys: string[] };
  'push:notification':        { type: string; title: string; message: string };
  'push:advisorySuggestions': Recommendation[];
  'push:memoCreated':         { memoId: string };
  'push:noteIndexed':         { noteId: string; chunkCount: number };
  'push:dbHealth':            { status: 'connected' | 'degraded' | 'disconnected' };
  'push:exportProgress':      import('../models').ExportProgress;
  'push:dlaPageReady':        { paperId: string; pageIndex: number; blocks: import('../models').ContentBlockDTO[] };
  /** AI command events — AI-initiated UI actions pushed to renderer */
  'push:aiCommand':           AICommandPayload;
}

// ─── AI Command payload (discriminated union for all AI → renderer events) ───

export type AICommandPayload =
  | { command: 'navigate'; view: ViewType; target?: { paperId?: string; conceptId?: string; page?: number; noteId?: string; articleId?: string }; reason?: string }
  | { command: 'apply-editor-patch'; patch: unknown; deferToChat?: boolean; messageId?: string; summary?: string }
  | { command: 'persist-document'; articleId: string; sectionId?: string }
  | { command: 'highlightPassage'; paperId: string; page: number; text: string; persistent: boolean; rect?: { x: number; y: number; w: number; h: number } }
  | { command: 'suggest'; suggestion: { id: string; title: string; description: string; actions: Array<{ id: string; label: string; primary?: boolean }>; priority: number; dismissAfterMs: number } }
  | { command: 'focusEntity'; entityType: 'paper' | 'concept' | 'note' | 'article'; entityId: string; anchor?: { page?: number; sectionId?: string; text?: string } }
  | { command: 'showComparison'; items: Array<{ entityType: string; entityId: string; label: string }>; aspect: string }
  | { command: 'notify'; level: 'info' | 'success' | 'warning'; title: string; message: string }
  | { command: 'updateSettings'; section: string; patch: Record<string, unknown>; reason: string };

// ═══════════════════════════════════════════════════════════════════════
// Fire-and-forget Contract — renderer → main (no response)
// ═══════════════════════════════════════════════════════════════════════

export interface IpcFireAndForgetContract {
  'reader:pageChanged': { args: [paperId: string, page: number] };
  /** User behavior events — renderer → main (forwarded to EventBus) */
  'event:userAction':   { args: [event: UserActionPayload] };
  /** User responds to an AI suggestion */
  'event:suggestionResponse': { args: [suggestionId: string, actionId: string] };
}

// ─── User action payload (renderer → main, forwarded to EventBus) ───

export type UserActionPayload =
  | { action: 'navigate'; view: ViewType; previousView: ViewType; target?: { paperId?: string; conceptId?: string; articleId?: string; noteId?: string } }
  | { action: 'selectPaper'; paperId: string; source: string }
  | { action: 'selectConcept'; conceptId: string; source: string }
  | { action: 'selectText'; paperId: string; text: string; page: number; rect?: { x: number; y: number; w: number; h: number } }
  | { action: 'highlight'; paperId: string; annotationId: string; text: string; page: number }
  | { action: 'openPaper'; paperId: string; hasPdf: boolean }
  | { action: 'pageChange'; paperId: string; page: number; totalPages: number }
  | { action: 'search'; query: string; scope: string }
  | { action: 'idle'; durationMs: number; lastView: ViewType }
  | { action: 'import'; format: string; count: number };

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

/** All push channel names */
export type IpcPushChannel = keyof IpcPushContract;

/** Extract push payload type */
export type IpcPushPayload<C extends IpcPushChannel> = IpcPushContract[C];

/** All fire-and-forget channel names */
export type IpcFireAndForgetChannel = keyof IpcFireAndForgetContract;
