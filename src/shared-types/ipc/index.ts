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
// TODO: Derive this interface from IpcContract automatically.
// For now it's kept hand-written for backward compatibility with renderer code.

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

  /** v3.0 工作区管理 */
  workspace: {
    create(opts: { rootDir: string; name?: string; description?: string }): Promise<WorkspaceInfo>;
    openDialog(): Promise<string | null>;
    listRecent(): Promise<RecentWorkspaceEntry[]>;
    getCurrent(): Promise<CurrentWorkspaceInfo | null>;
    switch(workspacePath: string): Promise<void>;
    removeRecent(workspacePath: string): Promise<void>;
    togglePin(workspacePath: string): Promise<boolean>;
    onSwitched(cb: (event: { rootDir: string; name: string }) => void): UnsubscribeFn;
  };
}

// ═══ 工作区类型 ═══

export interface WorkspaceInfo {
  rootDir: string;
  meta: {
    name: string;
    createdAt: string;
    version: string;
    description: string;
  };
}

export interface RecentWorkspaceEntry {
  path: string;
  name: string;
  lastOpenedAt: string;
  pinned: boolean;
}

export interface CurrentWorkspaceInfo {
  rootDir: string;
  name: string;
  paths: {
    root: string;
    internal: string;
    db: string;
    config: string;
    pdfs: string;
    texts: string;
    notes: string;
    reports: string;
    exports: string;
    privateDocs: string;
  };
}
