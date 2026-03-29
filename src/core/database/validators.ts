// ═══ 应用层枚举/约束校验 ═══
// 规范 §1.2: 不使用 CHECK 约束，全部枚举校验在 DAO 层执行。
// 本模块集中定义校验函数供 DAO 写入入口调用。

import { PAPER_TYPES, PAPER_SOURCES, FULLTEXT_STATUSES, ANALYSIS_STATUSES, RELEVANCES } from '../types/paper';
import type { PaperType, PaperSource, FulltextStatus, AnalysisStatus, Relevance } from '../types/paper';
import { CHUNK_SOURCES } from '../types/chunk';
import type { ChunkSource } from '../types/chunk';
import { IntegrityError } from '../types/errors';

// ─── 枚举校验（写入前调用） ───

function assertEnum<T extends string>(
  value: T,
  allowed: readonly string[],
  fieldName: string,
): void {
  if (!allowed.includes(value)) {
    throw new IntegrityError({
      message: `Invalid ${fieldName}: "${value}". Allowed: ${allowed.join(', ')}`,
      context: { dbPath: '', field: fieldName, value, allowed: [...allowed] },
    });
  }
}

export function validatePaperType(v: string): asserts v is PaperType {
  assertEnum(v, PAPER_TYPES, 'paper_type');
}

export function validatePaperSource(v: string): asserts v is PaperSource {
  assertEnum(v, PAPER_SOURCES, 'source');
}

export function validateFulltextStatus(v: string): asserts v is FulltextStatus {
  assertEnum(v, FULLTEXT_STATUSES, 'fulltext_status');
}

export function validateAnalysisStatus(v: string): asserts v is AnalysisStatus {
  assertEnum(v, ANALYSIS_STATUSES, 'analysis_status');
}

export function validateRelevance(v: string): asserts v is Relevance {
  assertEnum(v, RELEVANCES, 'relevance');
}

export function validateChunkSource(v: string): asserts v is ChunkSource {
  assertEnum(v, CHUNK_SOURCES, 'source');
}

// ─── §5.5 标注不变量 ───

/**
 * type='conceptTag' 时 concept_id 必须非空。
 * 在 addAnnotation 入口调用。
 */
export function validateAnnotationInvariant(
  type: string,
  conceptId: unknown,
): void {
  if (type === 'conceptTag' && (conceptId === null || conceptId === undefined)) {
    throw new IntegrityError({
      message: 'Annotation type "conceptTag" requires a non-null concept_id',
      context: { dbPath: '', field: 'concept_id', annotationType: type },
    });
  }
}

// ─── §4.1 置信度截断 ───

/** confidence [0.0, 1.0] 截断；NaN/非数值 → 0 */
export function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ─── §1.2 关系类型 ───

const RELATION_TYPES = ['supports', 'challenges', 'extends', 'operationalizes', 'irrelevant'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export function validateRelationType(v: string): asserts v is RelationType {
  assertEnum(v, RELATION_TYPES, 'relation');
}

// ─── §5.1 标注类型 ───

const ANNOTATION_TYPES = ['highlight', 'note', 'conceptTag'] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export function validateAnnotationType(v: string): asserts v is AnnotationType {
  assertEnum(v, ANNOTATION_TYPES, 'annotation_type');
}

// ─── §13.1 关系边类型 ───

const EDGE_TYPES = [
  'semantic_neighbor', 'concept_agree', 'concept_conflict',
  'concept_extend', 'article_cites',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export function validateEdgeType(v: string): asserts v is EdgeType {
  assertEnum(v, EDGE_TYPES, 'edge_type');
}

// ─── §14.1 建议状态 ───

import { SUGGESTION_STATUSES } from '../types/suggestion';
import type { SuggestionStatus } from '../types/suggestion';

export function validateSuggestionStatus(v: string): asserts v is SuggestionStatus {
  assertEnum(v, SUGGESTION_STATUSES, 'suggestion_status');
}
