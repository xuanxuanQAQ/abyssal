// ═══ 共享 Row → RankedChunk 映射工具 ═══
//
// 消除 retriever.ts / index.ts 中重复的手动映射逻辑。
// 所有从 SQLite row → RankedChunk 的转换统一走这里。

import type { RankedChunk, ChunkSource, ChunkOriginPath } from '../types/chunk';
import type { ChunkId, PaperId, MemoId } from '../types/common';
import { l2DistanceToScore } from '../infra/vector-math';
import { estimateMemoTokens } from '../infra/token-counter';

// ─── DB row → RankedChunk ───

/**
 * 将 SQLite 查询结果行映射为 RankedChunk。
 *
 * 支持两种 displayTitle 来源：
 *   - row['display_title'] (retriever JOIN papers)
 *   - row['paper_title'] (searchByOutlinePapers JOIN papers)
 * 调用方可通过 displayTitleOverride 显式指定。
 */
export function rowToRankedChunk(
  row: Record<string, unknown>,
  score: number,
  originPath: ChunkOriginPath,
  options?: {
    rawL2Distance?: number | null;
    displayTitleOverride?: string;
  },
): RankedChunk {
  const displayTitle =
    options?.displayTitleOverride ??
    (row['display_title'] as string | undefined) ??
    (row['paper_title'] as string | undefined) ??
    '';

  return {
    chunkId: row['chunk_id'] as ChunkId,
    paperId: (row['paper_id'] as string | null) as PaperId | null,
    text: row['text'] as string,
    tokenCount: row['token_count'] as number,
    sectionLabel: row['section_label'] as RankedChunk['sectionLabel'],
    sectionTitle: row['section_title'] as string | null,
    sectionType: row['section_type'] as RankedChunk['sectionType'],
    pageStart: row['page_start'] as number | null,
    pageEnd: row['page_end'] as number | null,
    source: row['source'] as ChunkSource,
    positionRatio: row['position_ratio'] as number | null,
    parentChunkId: (row['parent_chunk_id'] as string | null) as ChunkId | null,
    chunkIndex: row['chunk_index'] as number | null,
    contextBefore: row['context_before'] as string | null,
    contextAfter: row['context_after'] as string | null,
    blockType: (row['block_type'] as string | null) ?? undefined,
    readingOrder: (row['reading_order'] as number | null) ?? undefined,
    columnLayout: (row['column_layout'] as string | null) ?? undefined,
    score,
    rawL2Distance: options?.rawL2Distance ?? null,
    displayTitle,
    originPath,
  };
}

// ─── Memo → RankedChunk ───

export interface MemoLike {
  id: MemoId | string | number;
  text: string;
}

/**
 * 将 memo 对象映射为 RankedChunk。
 * 统一 retriever.annotationAndMemoRecall / index.searchByConcept 中重复的 memo 映射。
 */
export function memoToRankedChunk(
  memo: MemoLike,
  score: number = 1.0,
): RankedChunk {
  return {
    chunkId: `memo__${memo.id}` as ChunkId,
    paperId: null,
    text: memo.text,
    tokenCount: estimateMemoTokens(memo.text),
    sectionLabel: null,
    sectionTitle: null,
    sectionType: null,
    pageStart: null,
    pageEnd: null,
    source: 'memo' as const,
    positionRatio: null,
    parentChunkId: null,
    chunkIndex: null,
    contextBefore: null,
    contextAfter: null,
    score,
    rawL2Distance: null,
    displayTitle: '研究者笔记',
    originPath: 'memo' as const,
  };
}

// ─── Vector row merge utility ───

/**
 * 将 KNN 结果行合并到去重 Map。
 * 多变体命中的 chunk 获得 score boost（被多个查询变体匹配表明广泛相关性）。
 */
export function mergeVectorRows(
  rows: Array<Record<string, unknown>>,
  allResults: Map<string, RankedChunk>,
  variantHitCounts?: Map<string, number>,
): void {
  for (const row of rows) {
    const chunkId = row['chunk_id'] as string;
    const distance = row['distance'] as number;
    let score = l2DistanceToScore(distance);

    if (variantHitCounts) {
      const hitCount = (variantHitCounts.get(chunkId) ?? 0) + 1;
      variantHitCounts.set(chunkId, hitCount);
      if (hitCount > 1) {
        score = Math.min(1.0, score * (1 + 0.05 * (hitCount - 1)));
      }
    }

    const existing = allResults.get(chunkId);
    if (existing && existing.score >= score) continue;

    allResults.set(chunkId, rowToRankedChunk(row, score, 'vector', { rawL2Distance: distance }));
  }
}
