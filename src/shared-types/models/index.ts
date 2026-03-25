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
  ProjectStartMode,
  Maturity,
  ConceptChangeType,
  ConceptHistoryEventType,
  AdvisoryNotificationType,
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
  paperType: PaperType;
  relevance: Relevance;
  fulltextStatus: FulltextStatus;
  analysisStatus: AnalysisStatus;
  decisionNote: string | null;
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

export interface ArticleMetadata {
  authors?: string[] | undefined;
  institution?: string | undefined;
  abstract?: string | undefined;
  writingStyle?: string | undefined;
  targetWordCount?: number | undefined;
}

export interface ArticleOutline {
  id: string;
  title: string;
  citationStyle: CitationStyle;
  exportFormat: ExportFormat;
  metadata: ArticleMetadata;
  createdAt: string;
  updatedAt: string;
  sections: SectionNode[];
}

export interface SectionNode {
  id: string;
  title: string;
  parentId: string | null;
  sortIndex: number;
  status: SectionStatus;
  wordCount: number;
  writingInstructions: string | null;
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
  content: string; // Markdown（【Δ-4】不含标题）
  version: number;
}

export interface SectionPatch {
  content?: string | undefined;
  title?: string | undefined;
  wordCount?: number | undefined;
  citedPaperIds?: string[] | undefined;
  status?: SectionStatus | undefined;
  writingInstructions?: string | null | undefined;
}

export interface SectionVersion {
  version: number;
  content: string;
  createdAt: string;
  source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite';
}

// ═══ Graph ═══

export interface GraphNode {
  id: string;
  label: string;
  type: 'paper' | 'concept' | 'memo' | 'note';
  metadata?: Record<string, unknown> | undefined;
  /** §1.1 论文节点的 relevance */
  relevance?: import('../enums').Relevance | undefined;
  /** §1.1 论文被引次数 */
  citationCount?: number | undefined;
  /** §1.1 论文分析状态 */
  analysisStatus?: import('../enums').AnalysisStatus | undefined;
  /** §1.1 概念层级 */
  level?: number | undefined;
  /** §1.1 概念父 ID */
  parentId?: string | null | undefined;
}

export interface GraphEdge {
  id?: string | undefined;
  source: string;
  target: string;
  type: 'citation' | 'conceptAgree' | 'conceptConflict' | 'semanticNeighbor';
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
  byRelevance: Record<import('../enums').Relevance, number>;
  byAnalysisStatus: Record<import('../enums').AnalysisStatus, number>;
  byFulltextStatus: Record<import('../enums').FulltextStatus, number>;
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  status: MessageStatus;
  toolCalls?: ToolCallInfo[] | undefined;
  citations?: Citation[] | undefined;
  /** 流式接收中的临时文本缓冲（仅内存态，不持久化） */
  streamBuffer?: string | undefined;
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
  originView: import('../enums').ViewType;
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

export type ContextSource =
  | PaperContext
  | ConceptContext
  | MappingContext
  | SectionContext
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
  workflow: import('../enums').WorkflowType;
  status: string;
  currentStep: string;
  progress: { current: number; total: number };
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
  name: string;
  startMode: ProjectStartMode;
  embeddingModel?: string | undefined;
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
  paperCount: number;
  sourcePaperIds: string[];
  closestExisting: { conceptId: string; conceptName: string; maturity: Maturity } | null;
  contextSnippets: string[];
  suggestedKeywords: string[];
  status: 'pending' | 'accepted' | 'dismissed';
}

// ═══ v2.0 碎片笔记（Memo） ═══

export interface Memo {
  id: string;
  text: string;
  paperIds: string[];
  conceptIds: string[];
  annotationId: string | null;
  outlineId: string | null;
  linkedNoteId: string | null;
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
  filePath: string;
  linkedPaperIds: string[];
  linkedConceptIds: string[];
  tags: string[];
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewNote {
  title: string;
  linkedPaperIds?: string[];
  linkedConceptIds?: string[];
  tags?: string[];
  initialContent?: string;
}

export interface NoteFilter {
  conceptIds?: string[];
  paperIds?: string[];
  tags?: string[];
  searchText?: string;
}

export interface SaveNoteResult {
  chunksUpdated: number;
  frontmatterValid: boolean;
  frontmatterError?: string;
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
  coverage: import('../enums').RetrievalCoverage;
  gaps: string[];
}
