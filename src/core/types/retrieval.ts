import type { ConceptId, PaperId, MemoId } from './common';
import type { RankedChunk, SectionType, ChunkSource } from './chunk';

// ═══ 字面量联合 + const 数组 ═══

export const CONTEXT_BUDGET_MODES = ['focused', 'broad', 'full'] as const;
export type ContextBudgetMode = (typeof CONTEXT_BUDGET_MODES)[number];

export const COST_PREFERENCES = [
  'aggressive',
  'balanced',
  'conservative',
] as const;
export type CostPreference = (typeof COST_PREFERENCES)[number];

export const TASK_TYPES = [
  'analyze',
  'synthesize',
  'article',
  'ad_hoc',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const RETRIEVAL_COVERAGES = [
  'sufficient',
  'partial',
  'insufficient',
] as const;
export type RetrievalCoverage = (typeof RETRIEVAL_COVERAGES)[number];

// ═══ RetrievalRequest ═══

export interface RetrievalRequest {
  queryText: string;
  taskType: TaskType;
  conceptIds: ConceptId[];
  paperIds: PaperId[];
  sectionTypeFilter: SectionType[] | null;
  sourceFilter: ChunkSource[] | null;
  budgetMode: ContextBudgetMode;
  maxTokens: number;
  modelContextWindow: number;
  enableCorrectiveRag: boolean;
  relatedMemoIds: MemoId[];
  /** §9.2 智能降级：跳过 reranker（全量 chunk 直接注入时） */
  skipReranker?: boolean | undefined;
  /** §9.2 智能降级：跳过 query 扩展 */
  skipQueryExpansion?: boolean | undefined;
  /** Fix #1: adapter 层 budget-calculator 推导的 topK（优先于 budgetMode 硬编码值） */
  topK?: number | undefined;
  /** DLA block type filter — exclude/include chunks by their source block type */
  blockTypeFilter?: string[] | null | undefined;
}

// ═══ RetrievalQualityReport ═══

export interface RetrievalQualityReport {
  coverage: RetrievalCoverage;
  retryCount: number; // 0 = 一次通过
  gaps: string[];
  /** Average reranker score across returned chunks (0-1). */
  avgRerankerScore?: number;
  /** Proportion of chunks that passed the reranker threshold. */
  passRate?: number;
  /** Number of unique source papers represented. */
  sourceDiversity?: number;
}

// ═══ RetrievalResult ═══

export interface RetrievalResult {
  chunks: RankedChunk[];
  qualityReport: RetrievalQualityReport;
  totalTokenCount: number;
  injectedMemoCount: number;
  /** Fix #6: BM25 通道是否可用（FTS5 表存在且正常） */
  bm25Available?: boolean | undefined;
}
