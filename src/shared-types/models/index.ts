import type {
  Relevance,
  AnalysisStatus,
  FulltextStatus,
  PaperType,
  RelationType,
  AdjudicationStatus,
  AnnotationType,
  HighlightColor,
  SectionStatus,
  CitationStyle,
  ExportFormat,
  RetrievalPath,
  RetrievalCoverage,
  EvidenceStatus,
  RecommendationType,

  Maturity,
  ConceptChangeType,
  ConceptHistoryEventType,
  AdvisoryNotificationType,
  ViewType,
  WorkflowType,
} from '../enums';

// ═══ Paper ═══

export interface Author {
  name: string;
  affiliation?: string;
}

export interface Paper {
  id: string;
  title: string;
  authors: Author[];
  year: number;
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  pmcid: string | null;
  paperType: PaperType;
  relevance: Relevance;
  fulltextStatus: FulltextStatus;
  fulltextPath: string | null;
  fulltextSource: string | null;
  textPath: string | null;
  analysisStatus: AnalysisStatus;
  decisionNote: string | null;
  failureReason: string | null;
  failureCount: number;
  tags: string[];
  dateAdded: string; // ISO 8601
  /** §10.3 分析报告（Markdown 格式，由后端分析管线生成） */
  analysisReport: string | null;
}

// ═══ Concept ═══

export interface Concept {
  id: string;
  name: string;
  /** v2.0 中文名 */
  nameZh: string;
  /** v2.0 英文名 */
  nameEn: string;
  description: string;
  parentId: string | null;
  level: number;
  /** v2.0 成熟度 */
  maturity: Maturity;
  /** v2.0 关键词列表 */
  keywords: string[];
  /** v2.0 演化历史（JSON 数组） */
  history: HistoryEntry[];
}

export interface ConceptFramework {
  concepts: Concept[];
  rootIds: string[];
}

export interface AffectedMappings {
  affected: string[];
}

// ═══ ConceptMapping ═══

/** v1.2 双语证据结构 */
export interface BilingualEvidence {
  en: string;
  original: string;
  originalLang: string;
}

export interface ConceptMapping {
  id: string;
  paperId: string;
  conceptId: string;
  relationType: RelationType;
  confidence: number;
  evidenceText: string;
  evidencePage: number;
  adjudicationStatus: AdjudicationStatus;
  revisedMapping?: Partial<ConceptMapping>;
  /** v1.2 双语证据（后端分析管线生成） */
  evidence?: BilingualEvidence | undefined;
}

// ═══ Heatmap ═══

export interface HeatmapCell {
  conceptIndex: number;
  paperIndex: number;
  relationType: RelationType;
  confidence: number;
  mappingId: string;
  adjudicationStatus: AdjudicationStatus;
}

export interface HeatmapMatrix {
  conceptIds: string[];
  paperIds: string[];
  cells: HeatmapCell[];
}

// ═══ Annotation ═══

export interface AnnotationPosition {
  rects: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  pageWidth: number;
  pageHeight: number;
  coordinateSystem: 'pdf_points';
}

export interface Annotation {
  id: string;
  paperId: string;
  type: AnnotationType;
  page: number;
  position: AnnotationPosition;
  color: HighlightColor;
  text: string | null;
  conceptId: string | null;
  selectedText: string;
  /** §9.4 跨页标注组 ID（同组标注逻辑上是一个标注） */
  groupId: string | null;
  /** §10.5 PDF 文件双写同步状态 */
  pdfSyncStatus?: 'synced' | 'pending' | undefined;
}

export type NewAnnotation = Omit<Annotation, 'id'>;

// ═══ Article / Writing ═══

export interface ArticleAuthorInfo {
  name: string;
  affiliation?: string;
  email?: string;
  isCorresponding?: boolean;
}

export interface ArticleMetadata {
  authors?: ArticleAuthorInfo[] | undefined;
  institution?: string | undefined;
  abstract?: string | undefined;
  keywords?: string[] | undefined;
  writingStyle?: string | undefined;
  targetWordCount?: number | undefined;
}

export interface ArticleOutline {
  id: string;
  title: string;
  citationStyle: CitationStyle;
  exportFormat: ExportFormat;
  metadata: ArticleMetadata;
  defaultDraftId?: string | null | undefined;
  draftCount?: number | undefined;
  createdAt: string;
  updatedAt: string;
  sections: SectionNode[];
}

export interface ArticleWorkspaceSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  defaultDraftId: string | null;
  draftCount: number;
  latestDraftUpdatedAt?: string | undefined;
}

export interface DraftMetadata {
  abstract?: string | undefined;
  keywords?: string[] | undefined;
  writingStyle?: string | undefined;
  targetWordCount?: number | undefined;
  citationStyle?: CitationStyle | undefined;
  language?: string | undefined;
  audience?: string | undefined;
}

export interface DraftSummary {
  id: string;
  articleId: string;
  title: string;
  status: 'drafting' | 'review' | 'ready' | 'archived';
  metadata: DraftMetadata;
  basedOnDraftId?: string | null | undefined;
  source?: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' | 'ai-derive-draft' | 'duplicate' | undefined;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null | undefined;
}

export interface DraftOutline extends DraftSummary {
  sections: SectionNode[];
}

export interface DraftPatch {
  title?: string | undefined;
  status?: 'drafting' | 'review' | 'ready' | 'archived' | undefined;
  metadata?: DraftMetadata | undefined;
  lastOpenedAt?: string | null | undefined;
}

export interface DraftDocumentPayload {
  draftId: string;
  articleId: string;
  documentJson: string;
  updatedAt: string;
}

export interface DraftVersion {
  draftId: string;
  version: number;
  title: string;
  content: string;
  documentJson: string;
  createdAt: string;
  source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' | 'ai-derive-draft' | 'duplicate';
  summary?: string | null | undefined;
}

export interface SectionNode {
  id: string;
  title: string;
  parentId: string | null;
  sortIndex: number;
  status: SectionStatus;
  wordCount: number;
  writingInstructions: string | null;
  conceptIds?: string[] | undefined;
  paperIds?: string[] | undefined;
  aiModel: string | null;
  children: SectionNode[];
  /** v1.2 证据充分度状态 */
  evidenceStatus?: EvidenceStatus | undefined;
  /** v1.2 证据空白描述 */
  evidenceGaps?: string[] | undefined;
}

export interface SectionOrder {
  sectionId: string;
  parentId: string | null;
  sortIndex: number;
}

export interface SectionContent {
  id: string;
  outlineId: string;
  articleId?: string | undefined;
  title?: string | undefined;
  content: string; // Markdown（【Δ-4】不含标题）
  documentJson?: string | null | undefined;
  version: number;
  citedPaperIds: string[];
}

export interface SectionPatch {
  content?: string | undefined;
  documentJson?: string | null | undefined;
  title?: string | undefined;
  wordCount?: number | undefined;
  citedPaperIds?: string[] | undefined;
  status?: SectionStatus | undefined;
  writingInstructions?: string | null | undefined;
  aiModel?: string | null | undefined;
  evidenceStatus?: EvidenceStatus | undefined;
  evidenceGaps?: string[] | undefined;
}

export interface SectionVersion {
  sectionId?: string | undefined;
  title?: string | undefined;
  version: number;
  content: string;
  documentJson?: string | null | undefined;
  createdAt: string;
  source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite';
}

export interface ArticleDocumentPayload {
  articleId: string;
  documentJson: string;
  updatedAt: string;
}

// ═══ Full Document Operations ═══

export interface FullDocumentSection {
  sectionId: string;
  title: string;
  content: string;
  documentJson: string | null;
  version: number;
  sortIndex: number;
  parentId: string | null;
  depth: number;
}

export interface FullDocumentContent {
  articleId: string;
  sections: FullDocumentSection[];
}

export interface SectionSave {
  sectionId: string;
  title?: string | undefined;
  content: string;
  documentJson?: string | null;
  source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite';
}

// ═══ Article Asset ═══

export interface ArticleAsset {
  id: string;
  articleId: string;
  fileName: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
  caption: string | null;
  altText: string | null;
  createdAt: string;
}

// ═══ Cross Reference ═══

export type CrossRefType = 'figure' | 'table' | 'equation' | 'section';

export interface CrossRefLabel {
  id: string;
  articleId: string;
  label: string;
  refType: CrossRefType;
  sectionId: string | null;
  displayNumber: string | null;
}

// ═══ Export Progress ═══

export interface ExportProgress {
  stage: 'assembling' | 'formatting_citations' | 'generating_references' | 'converting' | 'writing';
  progress: number; // 0-100
  message: string;
}

// ═══ Graph ═══

export interface GraphNode {
  id: string;
  label: string;
  type: 'paper' | 'concept' | 'memo' | 'note';
  metadata?: Record<string, unknown> | undefined;
  /** §1.1 论文节点的 relevance */
  relevance?: Relevance | undefined;
  /** §1.1 论文被引次数 */
  citationCount?: number | undefined;
  /** §1.1 论文分析状态 */
  analysisStatus?: AnalysisStatus | undefined;
  /** §1.1 概念层级 */
  level?: number | undefined;
  /** §1.1 概念父 ID */
  parentId?: string | null | undefined;
}

export interface GraphEdge {
  id?: string | undefined;
  source: string;
  target: string;
  type:
    | 'citation'
    | 'conceptAgree'
    | 'conceptConflict'
    | 'conceptExtend'
    | 'semanticNeighbor'
    | 'conceptMapping'
    | 'notes';
  weight: number;
  /** §1.2 concept_agree/conflict 关联的概念 ID */
  conceptId?: string | undefined;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LayerVisibility {
  citation: boolean;
  conceptAgree: boolean;
  conceptConflict: boolean;
  conceptExtend: boolean;
  conceptMapping: boolean;
  semanticNeighbor: boolean;
  /** v2.0 笔记节点层 */
  notes: boolean;
}

// ═══ Tag ═══

export interface Tag {
  id: string;
  name: string;
  parentId: string | null;
  paperCount: number;
  color: string | null;
}

// ═══ PaperCounts ═══

export interface PaperCounts {
  total: number;
  byRelevance: Record<Relevance, number>;
  byAnalysisStatus: Record<AnalysisStatus, number>;
  byFulltextStatus: Record<FulltextStatus, number>;
}

// ═══ DiscoverRun ═══

export interface DiscoverRun {
  runId: string;
  query: string;
  resultCount: number;
  timestamp: string;
}

// ═══ RAG ═══

export interface RAGResult {
  chunkId: string;
  paperId: string;
  paperTitle: string;
  text: string;
  score: number;
  page: number;
  /** v1.2 检索路径来源 */
  retrievalPath?: RetrievalPath | undefined;
  /** v1.2 结构感知元数据 */
  sectionTitle?: string | undefined;
  sectionType?: string | undefined;
  contextBefore?: string | undefined;
  contextAfter?: string | undefined;
}

/** v1.2 检索质量报告 */
export interface RetrievalQualityReport {
  coverage: RetrievalCoverage;
  retryCount: number;
  gaps: string[];
}

/** v1.2 检索结果（包含质量报告） */
export interface RetrievalResult {
  chunks: RAGResult[];
  qualityReport: RetrievalQualityReport;
}

export interface SynthesisFragment {
  conceptId: string;
  text: string;
  sourceIds: string[];
}

export interface KBMatch {
  docId: string;
  text: string;
  score: number;
}

export interface WritingContext {
  relatedSyntheses: SynthesisFragment[];
  ragPassages: RAGResult[];
  privateKBMatches: KBMatch[];
  precedingSummary: string;
  followingSectionTitles: string[];
  /** RAG retrieval status: ok = retrieved, unavailable = module not configured, error = runtime failure */
  ragStatus: 'ok' | 'unavailable' | 'error';
  /** Human-readable detail when ragStatus is 'error' */
  ragStatusDetail?: string;
}

export interface WritingContextRequest {
  articleId?: string | undefined;
  draftId?: string | undefined;
  sectionId: string | null;
  mode?: 'local' | 'article' | 'draft' | undefined;
  documentJson?: string | undefined;
}

// ═══ Chat ═══

/** 消息状态（§5.2） */
export type MessageStatus =
  | 'sending'
  | 'sent'
  | 'streaming'
  | 'completed'
  | 'error';

/** Tool Call 执行状态 */
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ChatClarificationOption {
  id: string;
  label: string;
}

export interface ChatClarificationState {
  operationId: string;
  continuationToken: string;
  question: string;
  options: ChatClarificationOption[];
  submitting?: boolean | undefined;
  selectedOptionId?: string | undefined;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  status: MessageStatus;
  toolCalls?: ToolCallInfo[] | undefined;
  citations?: Citation[] | undefined;
  clarification?: ChatClarificationState | undefined;
  /** 流式接收中的临时文本缓冲（仅内存态，不持久化） */
  streamBuffer?: string | undefined;
  /** 待用户确认后应用到编辑器的 patch（两阶段确认，仅内存态） */
  pendingEditorPatches?: PendingEditorPatch[] | undefined;
}

/** 待确认的编辑器 patch */
export interface PendingEditorPatch {
  id: string;
  /** 对应的 EditorPatch JSON（保持类型解耦） */
  patch: Record<string, unknown>;
  /** 人类可读的描述 */
  summary: string;
  /** 是否已经被用户应用 */
  applied: boolean;
}

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  output?: string | undefined;
  status: ToolCallStatus;
  duration?: number | undefined;
}

/** AI 引用的论文段落（§5.2） */
export interface Citation {
  paperId: string;
  page?: number;
  text: string;
  relevanceScore: number;
}

/** 持久化到 SQLite 的聊天消息记录（§5.1.1） */
export interface ChatMessageRecord {
  id: string;
  contextSourceKey: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: string | undefined; // JSON
  citations?: string | undefined; // JSON
}

/** 会话摘要（§5.1.1 listSessions 返回） */
export interface ChatSessionSummary {
  contextSourceKey: string;
  messageCount: number;
  lastMessageAt: number;
}

/** 热缓存中的会话数据（§5.1.3） */
export interface ChatSessionCache {
  contextSourceKey: string;
  messages: ChatMessage[];
  lastActiveAt: number;
  fullyLoaded: boolean;
}

/** 分页查询参数（§5.1.1） */
export interface PaginationOpts {
  limit?: number;
  beforeTimestamp?: number;
}

// ═══ ContextSource（§2.2 上下文源抽象）═══

export interface PaperContext {
  type: 'paper';
  paperId: string;
  originView: ViewType;
}

export interface ConceptContext {
  type: 'concept';
  conceptId: string;
}

export interface MappingContext {
  type: 'mapping';
  mappingId: string;
  paperId: string;
  conceptId: string;
}

export interface SectionContext {
  type: 'section';
  articleId: string;
  sectionId: string;
  draftId?: string | undefined;
}

export interface GraphNodeContext {
  type: 'graphNode';
  nodeId: string;
  nodeType: 'paper' | 'concept' | 'memo' | 'note';
}

export interface EmptyContext {
  type: 'empty';
}

/** v2.0 Memo 上下文 */
export interface MemoContext {
  type: 'memo';
  memoId: string;
}

/** v2.0 Note 上下文 */
export interface NoteContext {
  type: 'note';
  noteId: string;
}

/** 多论文上下文（Library 多选） */
export interface PapersContext {
  type: 'papers';
  paperIds: string[];
  originView: ViewType;
}

/** 全选上下文（Ctrl+A / allExcept 模式，不枚举完整 ID 列表） */
export interface AllSelectedContext {
  type: 'allSelected';
  excludedCount: number;
}

/** 写作选区上下文（优先级高于 section，选区存在时覆盖 section 上下文） */
export interface WritingSelectionContext {
  type: 'writing-selection';
  articleId: string;
  draftId?: string | undefined;
  sectionId: string;
  from: number;
  to: number;
  selectedText: string;
  anchorParagraphId?: string | undefined;
}

export type ContextSource =
  | PaperContext
  | PapersContext
  | AllSelectedContext
  | ConceptContext
  | MappingContext
  | SectionContext
  | WritingSelectionContext
  | GraphNodeContext
  | MemoContext
  | NoteContext
  | EmptyContext;

// ═══ ProactiveTip（§3.5 Reader AI 提示）═══

export interface ProactiveTip {
  id: string;
  paperId: string;
  page: number;
  sectionRef: string;
  conceptId: string;
  conceptName: string;
  confidence: number;
  evidenceText: string;
}

// ═══ Pipeline ═══

export interface TaskUIState {
  taskId: string;
  workflow: WorkflowType;
  status: string;
  currentStep: string;
  progress: { current: number; total: number };
  /** 当前论文的子步骤进度（如 acquire cascade 各数据源状态） */
  substeps?: import('../ipc').SubstepInfo[];
}

export interface TaskHistoryEntry {
  taskId: string;
  workflow: WorkflowType;
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  completedAt: string;
  progress: { current: number; total: number };
  error?: { code: string; message: string };
}

// ═══ App Config ═══

export interface AppConfig {
  language: string;
  llmProvider: string;
  llmModel: string;
  workspacePath: string;
}

export interface ProjectInfo {
  name: string;
  paperCount: number;
  conceptCount: number;
  lastModified: string;
  workspacePath?: string;
}

// ═══ Import / Snapshot ═══

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface SnapshotInfo {
  id: string;
  name: string;
  createdAt: string;
  size: number;
}

export interface PDFAnnotation {
  page: number;
  position: AnnotationPosition;
  text: string;
  color: HighlightColor;
}

// ═══ v1.2 概念合并/拆分 ═══

export interface ConflictingMappings {
  mappings: ConceptMapping[];
}

export interface MergeDecision {
  mappingId: string;
  action: 'keep' | 'discard';
}

export interface NewConceptDef {
  name: string;
  description: string;
}

export interface MappingsToReassign {
  mappings: ConceptMapping[];
}

export interface MappingAssignment {
  mappingId: string;
  targetConceptId: string;
}

// ═══ v1.2 Advisory Agent ═══

export interface Recommendation {
  id: string;
  type: RecommendationType;
  title: string;
  description: string;
  evidence: string[];
  actionLabel: string;
}

// ═══ v1.2 快照清理 ═══

export interface CleanupPolicy {
  maxCount?: number | undefined;
  maxAgeDays?: number | undefined;
}

// ═══ v1.2 项目初始化 ═══

export interface ProjectSetupConfig {
  // Step 1: 项目基础
  name: string;
  workspacePath?: string | undefined;

  // Step 2: LLM 配置
  llmProvider: string;
  llmModel: string;
  llmApiKey?: string | undefined;

  // Step 3: 检索配置
  embeddingProvider: 'siliconflow' | 'jina' | 'openai';
  embeddingModel: string;
  embeddingApiKey?: string | undefined;
  rerankerBackend: 'cohere' | 'jina' | 'siliconflow';
  rerankerApiKey?: string | undefined;

  // Step 4: 语言与网络
  outputLanguage: string;
  proxyEnabled?: boolean | undefined;
  proxyUrl?: string | undefined;
  webSearchEnabled?: boolean | undefined;
  webSearchBackend?: 'tavily' | 'serpapi' | 'bing' | undefined;
  webSearchApiKey?: string | undefined;
  semanticScholarApiKey?: string | undefined;

  // Step 5: 文献源（可选）
  sourcePreset?: 'china' | 'overseas' | 'custom' | undefined;
  enabledSources?: string[] | undefined;

  initialConcepts?: string[] | undefined;
}

// ═══ v2.0 概念演化历史 ═══

export interface HistoryEntry {
  timestamp: string; // ISO 8601
  type: ConceptHistoryEventType;
  details: Record<string, unknown>;
}

// ═══ v2.0 概念草案（创建时使用） ═══

export interface ConceptDraft {
  nameZh: string;
  nameEn: string;
  definition: string;
  keywords: string[];
  parentId: string | null;
}

// ═══ v2.0 概念操作返回 ═══

export interface DefinitionUpdateResult {
  changeType: ConceptChangeType;
  affectedMappings: number;
}

export interface ConceptParentUpdateResult {
  success: boolean;
  cycleDetected?: boolean;
}

export interface MergeResult {
  migratedMappings: number;
  resolvedConflicts: number;
}

export interface SplitResult {
  concept1: Concept;
  concept2: Concept;
}

export interface MergeConflictResolution {
  mappingId: string;
  action: 'keep_retain' | 'keep_merge' | 'merge_confidence';
}

// ═══ v2.0 概念建议 ═══

export interface SuggestedConcept {
  id: string;
  term: string;
  termNormalized: string;
  frequency: number;
  sourcePaperIds: string[];
  sourcePaperCount: number;
  closestExisting: { conceptId: string; conceptName: string; maturity: Maturity; similarity: string | null } | null;
  reason: string;
  suggestedDefinition: string | null;
  suggestedKeywords: string[];
  status: 'pending' | 'adopted' | 'dismissed';
  adoptedConceptId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ═══ v2.0 碎片笔记（Memo） ═══

export interface Memo {
  id: string;
  text: string;
  paperIds: string[];
  conceptIds: string[];
  annotationId: string | null;
  outlineId: string | null;
  linkedNoteIds: string[];
  tags: string[];
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface NewMemo {
  text: string;
  paperIds?: string[];
  conceptIds?: string[];
  annotationId?: string;
  outlineId?: string;
  tags?: string[];
}

export interface MemoFilter {
  paperIds?: string[];
  conceptIds?: string[];
  tags?: string[];
  searchText?: string;
  limit?: number;
  offset?: number;
}

// ═══ v2.0 结构化笔记（Research Note） ═══

export interface NoteMeta {
  id: string;
  title: string;
  linkedPaperIds: string[];
  linkedConceptIds: string[];
  tags: string[];
  wordCount: number;
  documentJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewNote {
  title: string;
  linkedPaperIds?: string[];
  linkedConceptIds?: string[];
  tags?: string[];
  /** Markdown content — converted to ProseMirror JSON on creation */
  initialContent?: string;
  /** ProseMirror JSON — takes precedence over initialContent */
  documentJson?: string;
}

export interface NoteFilter {
  conceptIds?: string[];
  paperIds?: string[];
  tags?: string[];
  searchText?: string;
}

export interface SaveNoteContentResult {
  chunksUpdated: number;
}

// ═══ v2.0 Advisory 通知（事件驱动） ═══

export interface AdvisoryNotification {
  id: string;
  type: AdvisoryNotificationType;
  title: string;
  description: string;
  conceptId?: string;
  conceptName?: string;
  count?: number;
  percentage?: number;
  actionLabel: string;
  secondaryActionLabel?: string;
}

// ═══ v2.0 全局搜索结果 ═══

export interface GlobalSearchResult {
  entityId: string;
  entityType: 'paper' | 'concept' | 'article' | 'memo' | 'note';
  title: string;
  content: string;
  rank: number;
}

// ═══ v2.0 Section Quality Report（Corrective RAG） ═══

export interface SectionQualityReport {
  sectionId: string;
  coverage: RetrievalCoverage;
  gaps: string[];
}

// ═══ Settings ═══

/** Full settings data returned to the renderer (API keys masked) */
export interface SettingsData {
  project: {
    name: string;
    description: string;
  };
  llm: {
    defaultProvider: string;
    defaultModel: string;
    workflowOverrides: Record<string, { provider: string; model: string; maxTokens?: number }>;
  };
  rag: {
    embeddingModel: string;
    embeddingDimension: number;
    embeddingProvider: string;
    defaultTopK: number;
    expandFactor: number;
    rerankerBackend: string;
    rerankerModel: string | null;
    correctiveRagEnabled: boolean;
    correctiveRagMaxRetries: number;
    correctiveRagModel: string;
    tentativeExpandFactorMultiplier: number;
    tentativeTopkMultiplier: number;
    crossConceptBoostFactor: number;
  };
  acquire: {
    enabledSources: string[];
    enableScihub: boolean;
    scihubDomain: string | null;
    institutionalProxyUrl: string | null;
    perSourceTimeoutMs: number;
    maxRedirects: number;
    maxRetries: number;
    retryDelayMs: number;
    scihubMaxTotalMs: number;
    tarMaxExtractBytes: number;
    enableChinaInstitutional: boolean;
    chinaInstitutionId: string | null;
    chinaCustomIdpEntityId: string | null;
    enableCnki: boolean;
    enableWanfang: boolean;
    proxyEnabled: boolean;
    proxyUrl: string;
    proxyMode: 'all' | 'blocked-only';
  };
  discovery: {
    traversalDepth: number;
    maxResultsPerQuery: number;
    concurrency: number;
  };
  analysis: {
    maxTokensPerChunk: number;
    overlapTokens: number;
    ocrEnabled: boolean;
    vlmEnabled: boolean;
    autoSuggestConcepts: boolean;
  };
  language: {
    internalWorkingLanguage: string;
    defaultOutputLanguage: string;
    uiLocale: string;
  };
  contextBudget: {
    focusedMaxTokens: number;
    broadMaxTokens: number;
    outputReserveRatio: number;
    safetyMarginRatio: number;
    skipRerankerThreshold: number;
    costPreference: string;
  };
  apiKeys: {
    anthropicApiKey: string | null;
    openaiApiKey: string | null;
    geminiApiKey: string | null;
    deepseekApiKey: string | null;
    semanticScholarApiKey: string | null;
    unpaywallEmail: string | null;
    cohereApiKey: string | null;
    jinaApiKey: string | null;
    siliconflowApiKey: string | null;
    webSearchApiKey: string | null;
  };
  webSearch: {
    enabled: boolean;
    backend: 'tavily' | 'serpapi' | 'bing';
  };
  workspace: {
    baseDir: string;
  };
  personalization: {
    authorDisplayThreshold: number;
  };
  ai: {
    proactiveSuggestions: boolean;
  };
  appearance: {
    colorScheme: 'light' | 'dark' | 'system';
    accentColor: string;
    fontSize: 'sm' | 'base' | 'lg';
    animationEnabled: boolean;
  };
}

export interface DbStatsInfo {
  paperCount: number;
  analyzedCount: number;
  conceptCount: number;
  mappingCount: number;
  chunkCount: number;
  dbSizeBytes: number;
  embeddingModel: string;
  embeddingDimension: number;
}

export interface ApiKeyTestResult {
  ok: boolean;
  message: string;
}

export interface SystemInfo {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
}

// ═══ Concept Stats ═══

export interface ConceptStats {
  conceptId: string;
  mappingCount: number;
  paperCount: number;
  avgConfidence: number;
  relationDistribution: Record<string, number>;
  reviewedCount: number;
  unreviewedCount: number;
}

export interface SuggestedConceptsStats {
  pendingCount: number;
  adoptedCount: number;
  dismissedCount: number;
}

// ═══ DLA (Document Layout Analysis) ═══

export type ContentBlockType =
  | 'title' | 'text' | 'abandoned'
  | 'figure' | 'figure_caption'
  | 'table' | 'table_caption' | 'table_footnote'
  | 'formula' | 'formula_caption';

/** Content block DTO for renderer consumption */
export interface ContentBlockDTO {
  type: ContentBlockType;
  /** Normalized bounding box [0,1] relative to page dimensions */
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  pageIndex: number;
}

/** OCR word-level DTO for precise text alignment */
export interface OcrWordDTO {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
}

/** OCR line-level DTO for renderer consumption (scanned page text positioning) */
export interface OcrLineDTO {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  pageIndex: number;
  lineIndex: number;
  words?: OcrWordDTO[];
}

// ═══ Workspace ═══

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
