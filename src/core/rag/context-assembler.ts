// ═══ 上下文组装 ═══
// §5: 分组排序 → 连续段落合并 → 元数据头 → token 预算裁剪

import type { RankedChunk, ChunkSource } from '../types/chunk';
import type { ContextBudgetMode } from '../types/retrieval';
import { countTokens } from '../infra/token-counter';

// ─── §5.3 相邻性判定（含间隙合并 Fix #4） ───

/** 间隙合并的最大允许 token 数（中间省略的内容不超过此值时合并） */
const GAP_MERGE_MAX_TOKENS = 500;

interface AdjacencyResult {
  adjacent: boolean;
  /** 如果是间隙合并，需要插入省略标记 */
  gapped: boolean;
}

function areAdjacent(a: RankedChunk, b: RankedChunk): AdjacencyResult {
  // 条件 1: 同一 section 内的严格相邻子 chunk
  if (
    a.parentChunkId &&
    a.parentChunkId === b.parentChunkId &&
    a.chunkIndex != null &&
    b.chunkIndex != null &&
    Math.abs(a.chunkIndex - b.chunkIndex) === 1
  ) {
    return { adjacent: true, gapped: false };
  }

  // 条件 2: A 是 B 的父 chunk
  if (a.chunkId === b.parentChunkId || b.chunkId === a.parentChunkId) {
    return { adjacent: true, gapped: false };
  }

  // 条件 3: 同一节内相邻页
  if (
    a.pageEnd != null &&
    b.pageStart != null &&
    a.pageEnd === b.pageStart &&
    a.sectionLabel === b.sectionLabel
  ) {
    return { adjacent: true, gapped: false };
  }

  // 条件 4（Fix #4）: 间隙合并——同 paper + 同 section + 中间差距不大
  if (
    a.paperId &&
    a.paperId === b.paperId &&
    a.sectionLabel === b.sectionLabel &&
    a.parentChunkId &&
    a.parentChunkId === b.parentChunkId &&
    a.chunkIndex != null &&
    b.chunkIndex != null
  ) {
    const gap = Math.abs(a.chunkIndex - b.chunkIndex);
    // Fix: 使用实际 chunk 的平均 tokenCount 替代硬编码 300
    const avgTokens = Math.ceil((a.tokenCount + b.tokenCount) / 2);
    const estimatedGapTokens = (gap - 1) * avgTokens;
    if (gap <= 3 && estimatedGapTokens <= GAP_MERGE_MAX_TOKENS) {
      return { adjacent: true, gapped: true };
    }
  }

  return { adjacent: false, gapped: false };
}

// ─── §5.3 连续段落合并 ───

interface MergedGroup {
  chunks: RankedChunk[];
  text: string;
  maxScore: number;
  totalTokens: number;
  pageStart: number | null;
  pageEnd: number | null;
  contextBefore: string | null;
  contextAfter: string | null;
}

function mergeAdjacentChunks(chunks: RankedChunk[]): MergedGroup[] {
  if (chunks.length === 0) return [];

  // 按 positionRatio 排序（论文原文顺序）
  const sorted = [...chunks].sort(
    (a, b) => (a.positionRatio ?? 0) - (b.positionRatio ?? 0),
  );

  const groups: MergedGroup[] = [];
  let current: RankedChunk[] = [sorted[0]!];
  let hasGaps: boolean[] = []; // 标记哪些连接处是间隙合并

  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1]!;
    const curr = sorted[i]!;
    const adj = areAdjacent(prev, curr);

    if (adj.adjacent) {
      hasGaps.push(adj.gapped);
      current.push(curr);
    } else {
      groups.push(buildGroup(current, hasGaps));
      current = [curr];
      hasGaps = [];
    }
  }

  groups.push(buildGroup(current, hasGaps));
  return groups;
}

function buildGroup(chunks: RankedChunk[], gapFlags: boolean[] = []): MergedGroup {
  // 在间隙合并处插入省略标记
  const textParts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0 && gapFlags[i - 1]) {
      textParts.push('\n\n[...部分内容已省略...]\n');
    }
    textParts.push(chunks[i]!.text);
  }

  return {
    chunks,
    text: textParts.join('\n\n'),
    maxScore: Math.max(...chunks.map((c) => c.score)),
    totalTokens: chunks.reduce((s, c) => s + c.tokenCount, 0),
    pageStart: chunks[0]?.pageStart ?? null,
    pageEnd: chunks[chunks.length - 1]?.pageEnd ?? null,
    contextBefore: chunks[0]?.contextBefore ?? null,
    contextAfter: chunks[chunks.length - 1]?.contextAfter ?? null,
  };
}

// ─── §5.4 元数据头 ───

function formatMetadataHeader(chunk: RankedChunk): string {
  if (chunk.source === 'memo') {
    return `--- [memo] 研究者直觉 ---`;
  }
  if (chunk.source === 'annotation') {
    return `--- [annotation] 研究者标注 on ${chunk.displayTitle || 'Unknown'} (p.${chunk.pageStart ?? '?'}) ---`;
  }
  if (chunk.source === 'note') {
    return `--- [note] ${chunk.displayTitle || 'Note'} ---`;
  }
  if (chunk.source === 'private') {
    return `--- [private] ${chunk.displayTitle || 'Private Document'} ---`;
  }

  // paper / figure
  const title = chunk.displayTitle || 'Unknown';
  const section = chunk.sectionTitle ? ` | Section: ${chunk.sectionTitle}` : '';
  const pages =
    chunk.pageStart != null
      ? ` | Pages: ${chunk.pageStart}${chunk.pageEnd != null && chunk.pageEnd !== chunk.pageStart ? '-' + chunk.pageEnd : ''}`
      : '';
  return `--- [${chunk.originPath}] ${title}${section}${pages} ---`;
}

// ─── §5.1 assembleContext 主函数 ───

export interface AssembleResult {
  chunks: RankedChunk[];
  formattedContext: string;
  totalTokenCount: number;
}

export function assembleContext(
  rankedCandidates: RankedChunk[],
  forcedChunks: RankedChunk[],
  maxTokens: number,
  budgetMode: ContextBudgetMode,
): AssembleResult {
  // §5.2: 分离来源
  const memoChunks = forcedChunks.filter((c) => c.source === 'memo');
  const annotationChunks = forcedChunks.filter((c) => c.source === 'annotation');

  // 按 paper_id 分组候选 chunk
  const paperGroups = new Map<string, RankedChunk[]>();
  const otherChunks: RankedChunk[] = []; // private / note / figure

  for (const chunk of rankedCandidates) {
    if (chunk.paperId && (chunk.source === 'paper' || chunk.source === 'figure')) {
      const key = chunk.paperId;
      const arr = paperGroups.get(key) ?? [];
      arr.push(chunk);
      paperGroups.set(key, arr);
    } else {
      otherChunks.push(chunk);
    }
  }

  // §5.3: 论文分组内合并相邻 chunk
  const mergedPaperGroups: Array<{ paperId: string; groups: MergedGroup[]; maxScore: number }> = [];
  for (const [paperId, chunks] of paperGroups) {
    const merged = mergeAdjacentChunks(chunks);
    const maxScore = Math.max(...merged.map((g) => g.maxScore));
    mergedPaperGroups.push({ paperId, groups: merged, maxScore });
  }

  // §5.2: 论文分组间按最高 score 降序
  mergedPaperGroups.sort((a, b) => b.maxScore - a.maxScore);

  // §5.6: Token 预算裁剪
  // 先计算强制保留区域的 token
  const forcedTokens = [...memoChunks, ...annotationChunks].reduce(
    (s, c) => s + c.tokenCount,
    0,
  );
  let remainingBudget = maxTokens - forcedTokens;

  // 按优先级填充主检索区域
  const includedChunks: RankedChunk[] = [];

  // 论文分组
  for (const pg of mergedPaperGroups) {
    for (const group of pg.groups) {
      if (group.totalTokens <= remainingBudget) {
        includedChunks.push(...group.chunks);
        remainingBudget -= group.totalTokens;
      }
      // 预算不足则跳过此组
    }
  }

  // 其他 chunk（private / note）
  for (const chunk of otherChunks.sort((a, b) => b.score - a.score)) {
    if (chunk.tokenCount <= remainingBudget) {
      includedChunks.push(chunk);
      remainingBudget -= chunk.tokenCount;
    }
  }

  // §5.5: contextBefore/After 附带（broad/full 模式）
  const includeContext = budgetMode !== 'focused';

  // 组装格式化字符串
  const parts: string[] = [];

  // 高优先级区域
  if (memoChunks.length > 0) {
    for (const mc of memoChunks) {
      parts.push(formatMetadataHeader(mc));
      parts.push(mc.text);
    }
  }
  if (annotationChunks.length > 0) {
    for (const ac of annotationChunks) {
      parts.push(formatMetadataHeader(ac));
      parts.push(ac.text);
    }
  }

  // 主检索区域
  for (const chunk of includedChunks) {
    parts.push(formatMetadataHeader(chunk));
    if (includeContext && chunk.contextBefore) {
      parts.push(`[前文摘要] ${chunk.contextBefore}`);
    }
    parts.push(chunk.text);
    if (includeContext && chunk.contextAfter) {
      parts.push(`[后文摘要] ${chunk.contextAfter}`);
    }
  }

  const formattedContext = parts.join('\n\n');
  const allOutputChunks = [...memoChunks, ...annotationChunks, ...includedChunks];
  const totalTokenCount = countTokens(formattedContext);

  return {
    chunks: allOutputChunks,
    formattedContext,
    totalTokenCount,
  };
}
