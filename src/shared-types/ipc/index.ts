import type {
  Relevance,
  AnalysisStatus,
  FulltextStatus,
  ViewType,
  WorkflowType,
  AdjudicationDecision,
  PipelineStatus,
  ExportFormat,
  Maturity,
} from '../enums';

// Re-export ViewType for convenience
export type { ViewType } from '../enums';

import type {
  Paper,
  Concept,
  ConceptFramework,
  AffectedMappings,
  ConceptMapping,
  HeatmapMatrix,
  Annotation,
  NewAnnotation,
  ArticleOutline,
  SectionNode,
  SectionOrder,
  SectionContent,
  SectionPatch,
  SectionVersion,
  GraphData,
  RAGResult,
  WritingContext,
  AppConfig,
  ProjectInfo,
  ImportResult,
  SnapshotInfo,
  PDFAnnotation,
  LayerVisibility,
  ChatMessageRecord,
  ChatSessionSummary,
  PaginationOpts,
  Tag,
  PaperCounts,
  DiscoverRun,
  ConflictingMappings,
  MergeDecision,
  NewConceptDef,
  MappingsToReassign,
  MappingAssignment,
  RetrievalResult,
  Recommendation,
  CleanupPolicy,
  ProjectSetupConfig,
  // v2.0
  Memo,
  NewMemo,
  MemoFilter,
  NoteMeta,
  NewNote,
  NoteFilter,
  SaveNoteResult,
  SuggestedConcept,
  ConceptDraft,
  DefinitionUpdateResult,
  ConceptParentUpdateResult,
  MergeResult,
  SplitResult,
  MergeConflictResolution,
  HistoryEntry,
  AdvisoryNotification,
  GlobalSearchResult,
} from '../models';

// ═══ IPC 通道名常量 ═══

export const IPC_CHANNELS = {
  // db 域
  DB_PAPERS_LIST: 'db:papers:list',
  DB_PAPERS_GET: 'db:papers:get',
  DB_PAPERS_UPDATE: 'db:papers:update',
  DB_PAPERS_BATCH_UPDATE_RELEVANCE: 'db:papers:batchUpdateRelevance',
  DB_PAPERS_IMPORT_BIBTEX: 'db:papers:importBibtex',
  DB_PAPERS_COUNTS: 'db:papers:counts',
  DB_PAPERS_DELETE: 'db:papers:delete',
  DB_PAPERS_BATCH_DELETE: 'db:papers:batchDelete',

  // db:tags 域
  DB_TAGS_LIST: 'db:tags:list',
  DB_TAGS_CREATE: 'db:tags:create',
  DB_TAGS_UPDATE: 'db:tags:update',
  DB_TAGS_DELETE: 'db:tags:delete',

  // db:discoverRuns 域
  DB_DISCOVER_RUNS_LIST: 'db:discoverRuns:list',

  DB_CONCEPTS_LIST: 'db:concepts:list',
  DB_CONCEPTS_GET_FRAMEWORK: 'db:concepts:getFramework',
  DB_CONCEPTS_UPDATE_FRAMEWORK: 'db:concepts:updateFramework',

  DB_MAPPINGS_GET_FOR_PAPER: 'db:mappings:getForPaper',
  DB_MAPPINGS_GET_FOR_CONCEPT: 'db:mappings:getForConcept',
  DB_MAPPINGS_ADJUDICATE: 'db:mappings:adjudicate',
  DB_MAPPINGS_GET_HEATMAP_DATA: 'db:mappings:getHeatmapData',

  DB_ANNOTATIONS_LIST_FOR_PAPER: 'db:annotations:listForPaper',
  DB_ANNOTATIONS_CREATE: 'db:annotations:create',
  DB_ANNOTATIONS_UPDATE: 'db:annotations:update',
  DB_ANNOTATIONS_DELETE: 'db:annotations:delete',

  DB_ARTICLES_LIST_OUTLINES: 'db:articles:listOutlines',
  DB_ARTICLES_CREATE: 'db:articles:create',
  DB_ARTICLES_UPDATE: 'db:articles:update',
  DB_ARTICLES_GET_OUTLINE: 'db:articles:getOutline',
  DB_ARTICLES_UPDATE_OUTLINE_ORDER: 'db:articles:updateOutlineOrder',
  DB_ARTICLES_GET_SECTION: 'db:articles:getSection',
  DB_ARTICLES_UPDATE_SECTION: 'db:articles:updateSection',
  DB_ARTICLES_GET_SECTION_VERSIONS: 'db:articles:getSectionVersions',
  DB_SECTIONS_CREATE: 'db:sections:create',
  DB_SECTIONS_DELETE: 'db:sections:delete',

  DB_RELATIONS_GET_GRAPH: 'db:relations:getGraph',

  // rag 域
  RAG_SEARCH: 'rag:search',
  RAG_GET_WRITING_CONTEXT: 'rag:getWritingContext',

  // pipeline 域
  PIPELINE_START: 'pipeline:start',
  PIPELINE_CANCEL: 'pipeline:cancel',
  PIPELINE_PROGRESS_EVENT: 'pipeline:progress$event',
  PIPELINE_STREAM_CHUNK_EVENT: 'pipeline:streamChunk$event',

  // chat 域
  CHAT_SEND: 'chat:send',
  CHAT_RESPONSE_EVENT: 'chat:response$event',

  // db:chat 域（§5.1.1 聊天持久化）
  DB_CHAT_SAVE_MESSAGE: 'db:chat:saveMessage',
  DB_CHAT_GET_HISTORY: 'db:chat:getHistory',
  DB_CHAT_DELETE_SESSION: 'db:chat:deleteSession',
  DB_CHAT_LIST_SESSIONS: 'db:chat:listSessions',

  // fs 域
  // reader 域（§13.1 翻页事件，renderer→main 单向 push）
  READER_PAGE_CHANGED: 'reader:pageChanged',

  FS_OPEN_PDF: 'fs:openPDF',
  FS_SAVE_PDF_ANNOTATIONS: 'fs:savePDFAnnotations',
  FS_EXPORT_ARTICLE: 'fs:exportArticle',
  FS_IMPORT_FILES: 'fs:importFiles',
  FS_CREATE_SNAPSHOT: 'fs:createSnapshot',
  FS_RESTORE_SNAPSHOT: 'fs:restoreSnapshot',

  // db:articles 搜索（GlobalSearch 使用）
  DB_ARTICLES_SEARCH: 'db:articles:search',

  // app 域
  APP_GET_CONFIG: 'app:getConfig',
  APP_UPDATE_CONFIG: 'app:updateConfig',
  APP_GET_PROJECT_INFO: 'app:getProjectInfo',
  APP_SWITCH_PROJECT: 'app:switchProject',
  APP_LIST_PROJECTS: 'app:listProjects',

  // app:window 域
  APP_WINDOW_MINIMIZE: 'app:window:minimize',
  APP_WINDOW_TOGGLE_MAXIMIZE: 'app:window:toggleMaximize',
  APP_WINDOW_CLOSE: 'app:window:close',
  APP_WINDOW_POP_OUT: 'app:window:popOut',
  APP_WINDOW_LIST: 'app:window:list',

  // app:window 事件
  APP_WINDOW_MAXIMIZED_EVENT: 'app:window:maximized$event',
  APP_WINDOW_SYNC_STATE_EVENT: 'app:window:syncState$event',

  // 数据库变更通知
  DB_CHANGE_EVENT: 'db:change$event',

  // ═══ v1.2 新增 ═══

  // 概念合并/拆分
  DB_CONCEPTS_MERGE: 'db:concepts:merge',
  DB_CONCEPTS_RESOLVE_MERGE: 'db:concepts:resolveMerge',
  DB_CONCEPTS_SPLIT: 'db:concepts:split',
  DB_CONCEPTS_REASSIGN: 'db:concepts:reassign',

  // Advisory Agent
  ADVISORY_GET_RECOMMENDATIONS: 'advisory:getRecommendations',
  ADVISORY_EXECUTE: 'advisory:execute',

  // Graph 分页
  DB_RELATIONS_GET_NEIGHBORHOOD: 'db:relations:getNeighborhood',

  // 快照管理
  FS_LIST_SNAPSHOTS: 'fs:listSnapshots',
  FS_CLEANUP_SNAPSHOTS: 'fs:cleanupSnapshots',

  // 项目初始化
  APP_CREATE_PROJECT: 'app:createProject',

  // ═══ v2.0 新增 ═══

  // db:memos 域
  DB_MEMOS_LIST: 'db:memos:list',
  DB_MEMOS_GET: 'db:memos:get',
  DB_MEMOS_CREATE: 'db:memos:create',
  DB_MEMOS_UPDATE: 'db:memos:update',
  DB_MEMOS_DELETE: 'db:memos:delete',
  DB_MEMOS_UPGRADE_TO_NOTE: 'db:memos:upgradeToNote',
  DB_MEMOS_UPGRADE_TO_CONCEPT: 'db:memos:upgradeToConcept',

  // db:notes 域
  DB_NOTES_LIST: 'db:notes:list',
  DB_NOTES_GET: 'db:notes:get',
  DB_NOTES_CREATE: 'db:notes:create',
  DB_NOTES_UPDATE_META: 'db:notes:updateMeta',
  DB_NOTES_DELETE: 'db:notes:delete',
  DB_NOTES_UPGRADE_TO_CONCEPT: 'db:notes:upgradeToConcept',

  // fs:notes 域
  FS_READ_NOTE_FILE: 'fs:readNoteFile',
  FS_SAVE_NOTE_FILE: 'fs:saveNoteFile',

  // db:suggestedConcepts 域
  DB_SUGGESTED_CONCEPTS_LIST: 'db:suggestedConcepts:list',
  DB_SUGGESTED_CONCEPTS_ACCEPT: 'db:suggestedConcepts:accept',
  DB_SUGGESTED_CONCEPTS_DISMISS: 'db:suggestedConcepts:dismiss',
  DB_SUGGESTED_CONCEPTS_RESTORE: 'db:suggestedConcepts:restore',

  // db:concepts v2.0 扩展
  DB_CONCEPTS_CREATE: 'db:concepts:create',
  DB_CONCEPTS_UPDATE_MATURITY: 'db:concepts:updateMaturity',
  DB_CONCEPTS_UPDATE_DEFINITION: 'db:concepts:updateDefinition',
  DB_CONCEPTS_UPDATE_PARENT: 'db:concepts:updateParent',
  DB_CONCEPTS_GET_HISTORY: 'db:concepts:getHistory',

  // Advisory v2.0 事件
  ADVISORY_GET_NOTIFICATIONS: 'advisory:getNotifications',
  ADVISORY_NOTIFICATIONS_UPDATED_EVENT: 'advisory:notifications-updated$event',

  // Pipeline v2.0 事件
  PIPELINE_WORKFLOW_COMPLETE_EVENT: 'pipeline:workflow-complete$event',
  PIPELINE_SECTION_QUALITY_EVENT: 'pipeline:section-quality$event',

  // 全局搜索（FTS5）
  APP_GLOBAL_SEARCH: 'app:globalSearch',
} as const;

// ═══ Filter / Query 参数 ═══

export interface PaperFilter {
  relevance?: Relevance[];
  analysisStatus?: AnalysisStatus[];
  fulltextStatus?: FulltextStatus[];
  tags?: string[];
  searchQuery?: string;
  sortBy?: 'title' | 'year' | 'relevance' | 'dateAdded';
  sortOrder?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  discoverRunId?: string;
}

export interface GraphFilter {
  focusNodeId?: string;
  hopDepth?: 1 | 2 | 'global';
  layers?: LayerVisibility;
  similarityThreshold?: number;
  /** v2.0 是否包含笔记节点 */
  includeNotes?: boolean;
}

export interface RAGFilter {
  paperIds?: string[];
  conceptIds?: string[];
  maxResults?: number;
}

export interface WorkflowConfig {
  [key: string]: unknown;
}

// ═══ 事件载荷 ═══

export interface PipelineProgressEvent {
  taskId: string;
  workflow: WorkflowType;
  status: PipelineStatus;
  currentStep: string;
  progress: { current: number; total: number };
  entityId?: string;
  error?: { code: string; message: string };
}

export interface StreamChunkEvent {
  taskId: string;
  chunk: string;
  isLast: boolean;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    duration?: number;
  }>;
}

export interface ChatContext {
  activeView: ViewType;
  selectedPaperId?: string;
  selectedConceptId?: string;
  selectedSectionId?: string;
  pdfPage?: number;
}

export interface ChatResponseEvent {
  sessionId: string;
  chunk: string;
  isLast: boolean;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: string;
  }>;
}

export interface DBChangeEvent {
  table: string;
  operation: 'insert' | 'update' | 'delete';
  ids: string[];
}

// ═══ 窗口状态事件 ═══

export interface WindowMaximizedEvent {
  isMaximized: boolean;
}

// ═══ 文章搜索结果 ═══

export interface SectionSearchResult {
  sectionId: string;
  articleId: string;
  title: string;
  snippet: string;
}

// ═══ 错误结构体 ═══

export interface AbyssalIPCError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  retryAfterMs?: number;
}

// ═══ 取消订阅函数 ═══

export type UnsubscribeFn = () => void;

// ═══ AbyssalAPI 接口定义 ═══

export interface AbyssalAPI {
  db: {
    papers: {
      list(filter?: PaperFilter): Promise<Paper[]>;
      get(id: string): Promise<Paper>;
      update(id: string, patch: Partial<Paper>): Promise<void>;
      batchUpdateRelevance(ids: string[], rel: Relevance): Promise<void>;
      importBibtex(content: string): Promise<ImportResult>;
      getCounts(): Promise<PaperCounts>;
      delete(id: string): Promise<void>;
      batchDelete(ids: string[]): Promise<void>;
    };
    tags: {
      list(): Promise<Tag[]>;
      create(name: string, parentId?: string): Promise<Tag>;
      update(id: string, patch: Partial<Tag>): Promise<void>;
      delete(id: string): Promise<void>;
    };
    discoverRuns: {
      list(): Promise<DiscoverRun[]>;
    };
    concepts: {
      list(): Promise<Concept[]>;
      getFramework(): Promise<ConceptFramework>;
      updateFramework(fw: ConceptFramework): Promise<AffectedMappings>;
      search(query: string): Promise<Concept[]>;
      /** v2.0 创建概念 */
      create(draft: ConceptDraft): Promise<Concept>;
      /** v2.0 更新成熟度 */
      updateMaturity(conceptId: string, maturity: Maturity): Promise<{ historyEntry: HistoryEntry }>;
      /** v2.0 更新定义（含语义判定） */
      updateDefinition(conceptId: string, newDefinition: string): Promise<DefinitionUpdateResult>;
      /** v2.0 更新父节点（含环路检测） */
      updateParent(conceptId: string, newParentId: string | null): Promise<ConceptParentUpdateResult>;
      /** v2.0 获取演化历史 */
      getHistory(conceptId: string): Promise<HistoryEntry[]>;
      /** v2.0 合并（新 4 步） */
      merge(retainId: string, mergeId: string, conflictResolutions: MergeConflictResolution[]): Promise<MergeResult>;
      /** v2.0 拆分（新 3 步） */
      split(originalId: string, concept1: ConceptDraft, concept2: ConceptDraft, mappingAssignments: MappingAssignment[]): Promise<SplitResult>;
      /** @deprecated v1.2 — 保留向后兼容 */
      resolveMergeConflicts(decisions: MergeDecision[]): Promise<void>;
      reassignMappings(assignments: MappingAssignment[]): Promise<void>;
    };
    /** v2.0 碎片笔记 */
    memos: {
      list(filter?: MemoFilter): Promise<Memo[]>;
      get(memoId: string): Promise<Memo>;
      create(memo: NewMemo): Promise<Memo>;
      update(memoId: string, patch: Partial<Memo>): Promise<Memo>;
      delete(memoId: string): Promise<void>;
      upgradeToNote(memoId: string): Promise<{ noteId: string; filePath: string }>;
      upgradeToConcept(memoId: string, draft: ConceptDraft): Promise<Concept>;
    };
    /** v2.0 结构化笔记 */
    notes: {
      list(filter?: NoteFilter): Promise<NoteMeta[]>;
      get(noteId: string): Promise<NoteMeta>;
      create(note: NewNote): Promise<{ noteId: string; filePath: string }>;
      updateMeta(noteId: string, patch: Partial<NoteMeta>): Promise<NoteMeta>;
      delete(noteId: string): Promise<void>;
      upgradeToConcept(noteId: string, draft: ConceptDraft): Promise<Concept>;
    };
    /** v2.0 概念建议队列 */
    suggestedConcepts: {
      list(): Promise<SuggestedConcept[]>;
      accept(suggestedId: string, draft: ConceptDraft): Promise<Concept>;
      dismiss(suggestedId: string): Promise<void>;
      restore(suggestedId: string): Promise<void>;
    };
    mappings: {
      getForPaper(paperId: string): Promise<ConceptMapping[]>;
      getForConcept(conceptId: string): Promise<ConceptMapping[]>;
      adjudicate(
        mappingId: string,
        decision: AdjudicationDecision,
        revisedMapping?: Partial<ConceptMapping>
      ): Promise<void>;
      getHeatmapData(): Promise<HeatmapMatrix>;
    };
    annotations: {
      listForPaper(paperId: string): Promise<Annotation[]>;
      create(annotation: NewAnnotation): Promise<Annotation>;
      update(id: string, patch: Partial<Annotation>): Promise<void>;
      delete(id: string): Promise<void>;
    };
    articles: {
      listOutlines(): Promise<ArticleOutline[]>;
      create(title: string): Promise<ArticleOutline>;
      update(articleId: string, patch: Partial<ArticleOutline>): Promise<void>;
      getOutline(articleId: string): Promise<ArticleOutline>;
      updateOutlineOrder(
        articleId: string,
        order: SectionOrder[]
      ): Promise<void>;
      getSection(sectionId: string): Promise<SectionContent>;
      updateSection(sectionId: string, patch: SectionPatch): Promise<void>;
      getSectionVersions(sectionId: string): Promise<SectionVersion[]>;
      createSection(
        articleId: string,
        parentId: string | null,
        sortIndex: number,
        title?: string
      ): Promise<SectionNode>;
      deleteSection(sectionId: string): Promise<void>;
      search(query: string): Promise<SectionSearchResult[]>;
    };
    relations: {
      getGraph(filter?: GraphFilter): Promise<GraphData>;
      /** v1.2 分页加载邻域 */
      getNeighborhood(nodeId: string, depth: number, layers?: LayerVisibility): Promise<GraphData>;
    };

    chat: {
      saveMessage(record: ChatMessageRecord): Promise<void>;
      getHistory(contextKey: string, opts?: PaginationOpts): Promise<ChatMessageRecord[]>;
      deleteSession(contextKey: string): Promise<void>;
      listSessions(): Promise<ChatSessionSummary[]>;
    };
  };

  rag: {
    search(query: string, filter?: RAGFilter): Promise<RAGResult[]>;
    /** v1.2 带质量报告的检索 */
    searchWithReport(query: string, filter?: RAGFilter): Promise<RetrievalResult>;
    getWritingContext(sectionId: string): Promise<WritingContext>;
  };

  pipeline: {
    start(workflow: WorkflowType, config?: WorkflowConfig): Promise<string>;
    cancel(taskId: string): Promise<void>;
    onProgress(cb: (event: PipelineProgressEvent) => void): UnsubscribeFn;
    onStreamChunk(cb: (event: StreamChunkEvent) => void): UnsubscribeFn;
  };

  chat: {
    send(message: string, context?: ChatContext): Promise<string>;
    onResponse(cb: (event: ChatResponseEvent) => void): UnsubscribeFn;
  };

  reader: {
    /** §13.1 翻页事件推送（fire-and-forget，非 invoke） */
    pageChanged(paperId: string, page: number): void;
  };

  fs: {
    openPDF(paperId: string): Promise<{ path: string; buffer: ArrayBuffer }>;
    savePDFAnnotations(
      paperId: string,
      annotations: PDFAnnotation[]
    ): Promise<void>;
    exportArticle(articleId: string, format: ExportFormat): Promise<string>;
    importFiles(paths: string[]): Promise<ImportResult>;
    createSnapshot(name: string): Promise<SnapshotInfo>;
    restoreSnapshot(snapshotId: string): Promise<void>;
    /** v1.2 快照列表（含磁盘占用） */
    listSnapshots(): Promise<SnapshotInfo[]>;
    /** v1.2 快照清理 */
    cleanupSnapshots(policy: CleanupPolicy): Promise<void>;
    /** v2.0 读取笔记文件内容 */
    readNoteFile(noteId: string): Promise<string>;
    /** v2.0 保存笔记文件内容 */
    saveNoteFile(noteId: string, content: string): Promise<SaveNoteResult>;
  };

  /** v1.2 Advisory Agent */
  advisory: {
    getRecommendations(): Promise<Recommendation[]>;
    execute(id: string): Promise<string>;
    /** v2.0 事件驱动通知 */
    getNotifications(): Promise<AdvisoryNotification[]>;
    onNotificationsUpdated(cb: (notifications: AdvisoryNotification[]) => void): UnsubscribeFn;
  };

  app: {
    getConfig(): Promise<AppConfig>;
    updateConfig(patch: Partial<AppConfig>): Promise<void>;
    getProjectInfo(): Promise<ProjectInfo>;
    switchProject(projectPath: string): Promise<void>;
    listProjects(): Promise<ProjectInfo[]>;
    /** v1.2 创建项目 */
    createProject(config: ProjectSetupConfig): Promise<ProjectInfo>;
    /** v2.0 全局搜索（FTS5） */
    globalSearch(query: string): Promise<GlobalSearchResult[]>;
    /** v2.0 Pipeline 事件 */
    onWorkflowComplete(cb: (event: { workflow: WorkflowType; taskId: string }) => void): UnsubscribeFn;
    onSectionQuality(cb: (event: { sectionId: string; coverage: string; gaps: string[] }) => void): UnsubscribeFn;
    window: {
      minimize(): Promise<void>;
      toggleMaximize(): Promise<boolean>;
      close(): Promise<void>;
      popOut(viewType: ViewType, entityId?: string): Promise<void>;
      onMaximizedChange(cb: (event: WindowMaximizedEvent) => void): UnsubscribeFn;
    };
  };
}
