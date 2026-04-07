/**
 * Zod runtime validation schemas — DB 读取边界的数据完整性校验。
 *
 * 设计原则：
 * - 只在单条记录读取（getPaper, getConcept 等）时校验，不在批量查询上加 N×cost
 * - 校验失败时 warn + 返回原始数据（graceful degradation），不 crash
 * - schema 使用 .passthrough() 允许未知字段（forward compatibility）
 */

import { z } from 'zod/v4';
import { fromRow } from './row-mapper';
import type { Logger } from '../infra/logger';

// ─── Paper ───

export const PaperRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int(),
  doi: z.string().nullable().optional(),
  arxivId: z.string().nullable().optional(),
  abstract: z.string().nullable().optional(),
  paperType: z.string(),
  source: z.string(),
  fulltextStatus: z.string().optional(),
  analysisStatus: z.string().optional(),
  relevance: z.string().optional(),
}).passthrough();

// ─── Concept ───

export const ConceptRowSchema = z.object({
  id: z.string(),
  nameZh: z.string(),
  nameEn: z.string(),
  layer: z.string(),
  definition: z.string(),
  searchKeywords: z.array(z.string()),
  maturity: z.enum(['tag', 'tentative', 'working', 'established']),
  parentId: z.string().nullable(),
  history: z.array(z.object({
    timestamp: z.string(),
    changeType: z.string(),
    oldValueSummary: z.string(),
    reason: z.string().nullable(),
    isBreaking: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }).passthrough()),
  deprecated: z.boolean(),
  deprecatedAt: z.string().nullable(),
  deprecatedReason: z.string().nullable(),
  createdAt: z.string(),
}).passthrough();

// ─── Memo ───

export const MemoRowSchema = z.object({
  id: z.string(),
  text: z.string(),
  paperIds: z.array(z.string()),
  conceptIds: z.array(z.string()),
  annotationId: z.number().nullable(),
  outlineId: z.string().nullable(),
  linkedNoteIds: z.array(z.string()),
  tags: z.array(z.string()),
  indexed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

// ─── Note ───

export const NoteRowSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  title: z.string(),
  linkedPaperIds: z.array(z.string()),
  linkedConceptIds: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

// ─── Chunk ───

export const ChunkRowSchema = z.object({
  chunkId: z.string(),
  paperId: z.string().nullable().optional(),
  sectionLabel: z.string().nullable().optional(),
  sectionTitle: z.string().nullable().optional(),
  sectionType: z.string().nullable().optional(),
  pageStart: z.number().nullable().optional(),
  pageEnd: z.number().nullable().optional(),
  text: z.string(),
  tokenCount: z.number().int(),
  source: z.enum(['paper', 'annotation', 'private', 'memo', 'note', 'figure']),
  positionRatio: z.number().nullable().optional(),
  parentChunkId: z.string().nullable().optional(),
  chunkIndex: z.number().nullable().optional(),
  contextBefore: z.string().nullable().optional(),
  contextAfter: z.string().nullable().optional(),
}).passthrough();

// ─── 通用校验包装 ───

/**
 * 安全的 fromRow + schema 校验。
 *
 * - 正常：返回经过 zod 校验的数据
 * - 异常：warn 日志 + 返回未校验的 fromRow 结果（不 crash）
 *
 * 只用于单条记录读取，不用于批量查询。
 */
/**
 * 安全的 fromRow + schema 校验。
 *
 * schema 参数接受 any zod type——我们只用它做运行时验证，
 * 不依赖 zod 的类型推导（T 由调用方的泛型参数决定）。
 */
export function safeFromRow<T>(
  row: Record<string, unknown>,
  schema: z.ZodType<any>,
  logger?: Logger,
): T {
  const mapped = fromRow<T>(row);
  const result = schema.safeParse(mapped);
  if (!result.success) {
    logger?.warn('Row validation warning — returning raw mapped data', {
      issues: result.error.issues.slice(0, 3).map((i: any) => ({
        path: i.path?.join('.'),
        message: i.message,
      })),
    });
    return mapped;
  }
  return result.data as T;
}
