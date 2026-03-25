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
}

// ═══ RetrievalQualityReport ═══

export interface RetrievalQualityReport {
  coverage: RetrievalCoverage;
  retryCount: number; // 0 = 一次通过
  gaps: string[];
}

// ═══ RetrievalResult ═══

export interface RetrievalResult {
  chunks: RankedChunk[];
  qualityReport: RetrievalQualityReport;
  totalTokenCount: number;
  injectedMemoCount: number;
}
