// ═══ 上下文组装 ═══
// §5: 分组排序 → 连续段落合并 → 元数据头 → token 预算裁剪

import type { RankedChunk } from '../types/chunk';
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
  // Fix: null positionRatio 排到末尾（非 paper 类型的 chunk），而非排到最前
  const sorted = [...chunks].sort((a, b) => {
    const aRatio = a.positionRatio ?? 1;
    const bRatio = b.positionRatio ?? 1;
    if (aRatio !== bRatio) return aRatio - bRatio;
    // Tiebreaker: chunkIndex → chunkId 字典序
    if (a.chunkIndex != null && b.chunkIndex != null && a.chunkIndex !== b.chunkIndex) {
      return a.chunkIndex - b.chunkIndex;
    }
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });

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
  const dedupedCandidates: RankedChunk[] = [];
  const seenChunkIds = new Set<string>();
  for (const chunk of rankedCandidates) {
    if (seenChunkIds.has(chunk.chunkId)) continue;
    seenChunkIds.add(chunk.chunkId);
    dedupedCandidates.push(chunk);
  }

  // §5.2: 分离来源
  const memoChunks = forcedChunks.filter((c) => c.source === 'memo');
  const annotationChunks = forcedChunks.filter((c) => c.source === 'annotation');

  // 按 paper_id 分组候选 chunk
  const paperGroups = new Map<string, RankedChunk[]>();
  const otherChunks: RankedChunk[] = []; // private / note / figure

  for (const chunk of dedupedCandidates) {
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
  // Fix #3: 动态计算元数据头 overhead（不同 source 产出长度不同）
  const estimateMetadataOverhead = (c: RankedChunk): number => {
    // memo/annotation/note/private 头较短 (~20 tokens)，paper 头较长 (~50 tokens)
    if (c.source === 'memo' || c.source === 'note') return 20;
    if (c.source === 'annotation' || c.source === 'private') return 25;
    // paper/figure 含 title + section + pages
    let overhead = 30;
    if (c.sectionTitle) overhead += 10;
    if (c.pageStart != null) overhead += 10;
    return overhead;
  };

  // Fix: 不从 maxTokens 中扣除 forced chunks 预算。
  // adapter 层的 BudgetAllocation 已将 researcher_memos/annotations 作为 ABSOLUTE 源
  // 单独预扣（sourceAllocations），传入的 maxTokens 已是非 ABSOLUTE 源（rag_passages 等）的预算。
  let remainingBudget = maxTokens;

  // 按优先级填充主检索区域
  const includedChunks: RankedChunk[] = [];

  // ── 多样性保障：每篇论文至少 1 个代表 chunk（防止高分论文垄断 context window） ──
  // Phase 1: 每个 paper group 选入最高分的 1 个 group
  const contextOverhead = budgetMode !== 'focused' ? 30 : 0; // ~30 tokens for context labels

  const computeGroupCost = (group: MergedGroup): number => {
    const groupMetaOverhead = group.chunks.reduce((s, c) => s + estimateMetadataOverhead(c), 0);
    return group.totalTokens
      + groupMetaOverhead
      + (group.contextBefore ? contextOverhead : 0)
      + (group.contextAfter ? contextOverhead : 0);
  };

  // 允许 group 在轻微超标（≤ 20%）时保持完整性——adapter 层有 safetyMargin 缓冲
  const COHERENCE_OVERFLOW_RATIO = 1.2;

  const diversitySeeded = new Set<string>(); // 已放入代表 chunk 的 paperId
  for (const pg of mergedPaperGroups) {
    const bestGroup = pg.groups[0]; // groups 内已按 positionRatio 排列，取第一组最相关
    if (!bestGroup) continue;
    const cost = computeGroupCost(bestGroup);
    if (cost <= remainingBudget) {
      includedChunks.push(...bestGroup.chunks);
      remainingBudget -= cost;
      diversitySeeded.add(pg.paperId);
    }
  }

  // Phase 2: 剩余预算填入各 paper group 的其余 groups
  for (const pg of mergedPaperGroups) {
    for (const group of pg.groups) {
      // 已在 Phase 1 放入的 group 跳过
      if (diversitySeeded.has(pg.paperId) && group === pg.groups[0]) continue;

      const groupCost = computeGroupCost(group);
      if (groupCost <= remainingBudget) {
        includedChunks.push(...group.chunks);
        remainingBudget -= groupCost;
      } else if (groupCost <= remainingBudget * COHERENCE_OVERFLOW_RATIO && remainingBudget > 0) {
        // 轻微超标但保持段落完整性
        includedChunks.push(...group.chunks);
        remainingBudget -= groupCost;
      } else if (group.chunks.length > 1 && remainingBudget > 0) {
        // 最后手段：组内按 score 降序逐个塞入
        const sortedChunks = [...group.chunks].sort((a, b) => b.score - a.score);
        for (const chunk of sortedChunks) {
          const chunkCost = chunk.tokenCount + estimateMetadataOverhead(chunk);
          if (chunkCost <= remainingBudget) {
            includedChunks.push(chunk);
            remainingBudget -= chunkCost;
          }
        }
      }
    }
  }

  // 其他 chunk（private / note）
  for (const chunk of otherChunks.sort((a, b) => b.score - a.score)) {
    const chunkCost = chunk.tokenCount + estimateMetadataOverhead(chunk);
    if (chunkCost <= remainingBudget) {
      includedChunks.push(chunk);
      remainingBudget -= chunkCost;
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
