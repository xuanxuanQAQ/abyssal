import type {
  Relevance,
  AnalysisStatus,
  FulltextStatus,
  ViewType,
  WorkflowType,
  PipelineStatus,
} from '../enums';

// Re-export ViewType for convenience
export type { ViewType } from '../enums';

import type { LayerVisibility } from '../models';

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

/** 子步骤状态（用于 acquire cascade 等多阶段任务的细粒度进度） */
export interface SubstepInfo {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  detail?: string;
}

export interface PipelineProgressEvent {
  taskId: string;
  workflow: WorkflowType;
  status: PipelineStatus;
  currentStep: string;
  progress: { current: number; total: number };
  entityId?: string;
  error?: { code: string; message: string };
  /** 当前论文的子步骤进度（如 acquire cascade 各数据源状态） */
  substeps?: SubstepInfo[];
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

/** DLA 截图引用（图片区域截取） */
export interface ChatImageClip {
  /** Block type (figure, table, formula, etc.) */
  type: string;
  /** Base64 JPEG data URL */
  dataUrl: string;
  /** 1-based page number */
  pageNumber: number;
  /** Normalized bbox on page */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface ChatContext {
  activeView: ViewType;
  contextKey: string;
  selectedPaperId?: string;
  /** 多论文上下文（Library 多选时） */
  selectedPaperIds?: string[];
  selectedConceptId?: string;
  selectedSectionId?: string;
  pdfPage?: number;
  /** 用户在 PDF 阅读器中选取的引用文本 */
  selectedQuote?: string;
  /** DLA 智能选取的图片截图（figure/table/formula） */
  imageClips?: ChatImageClip[];
}

/**
 * Agent stream chunk — canonical type for all agent/chat streaming events.
 *
 * Discriminated union on `type`:
 * - text_delta: incremental text content
 * - tool_use_start: tool invocation started
 * - tool_use_result: tool returned result
 * - done: conversation turn complete
 * - error: agent error
 */
export type AgentStreamEvent =
  | { type: 'text_delta'; conversationId: string; delta: string }
  | { type: 'tool_use_start'; conversationId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_use_result'; conversationId: string; toolName: string; result: string }
  | { type: 'done'; conversationId: string; fullText: string; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; conversationId: string; code: string; message: string };

/** @deprecated Use AgentStreamEvent instead */
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

// ═══ Acquire 状态信息 ═══

export interface AcquireStatusInfo {
  fulltextStatus: import('../enums').FulltextStatus;
  fulltextPath: string | null;
  fulltextSource: string | null;
  failureReason: string | null;
  failureCount: number;
}

// ═══ 机构访问 Session 状态 ═══

export interface InstitutionalSessionStatus {
  loggedIn: boolean;
  institutionId: string | null;
  institutionName: string | null;
  lastLogin: string | null;
  activeDomains: string[];
}

export interface InstitutionListItem {
  id: string;
  name: string;
  nameEn: string;
  publishers: string[];
}

export interface InstitutionalLoginResult {
  success: boolean;
  cookieCount: number;
  publisher: string;
}

// ═══ 错误结构体 ═══

/**
 * IPC 错误传输格式。
 * 与 electron/ipc/register.ts wrapHandler() 实际序列化的结构对齐。
 */
export interface AbyssalIPCError {
  code: string;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
  retryAfterMs?: number;
}

// ═══ 取消订阅函数 ═══

export type UnsubscribeFn = () => void;

// ═══ AbyssalAPI — 从 IPC Contract 自动推导 ═══

export type { DerivedAbyssalAPI as AbyssalAPI } from './derive';
