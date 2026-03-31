// ═══ 结构感知分块引擎 ═══
// §4: Section→段落两层分块 + overlap + 页码映射
//
// 改进：
//   - Fix #1: 使用 boundary.charStart 代替 indexOf 定位 section
//   - Fix #2: 段落偏移量累加器代替 indexOf 回查
//   - Fix #3: overlapTokens < maxTokens/2 防御性检查
//   - Fix #4: extractTailTokens 二分搜索精确定位（CJK 友好）
//   - Fix #5: parentChunkId 使用 sectionPage 保持稳定

import type { PaperId, ChunkId } from '../types/common';
import { asChunkId } from '../types/common';
import type {
  TextChunk,
  SectionLabel,
  SectionType,
  SectionMap,
  SectionMapV2,
  SectionEntry,
  SectionBoundaryList,
  ChunkSource,
} from '../types/chunk';
import { countTokens } from '../infra/token-counter';

// ─── §4.4 页码映射 ───

function buildPageOffsets(pageTexts: string[]): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < pageTexts.length - 1; i++) {
    offsets.push(offsets[i]! + pageTexts[i]!.length + 2); // +2 for '\n\n'
  }
  return offsets;
}

function findPage(charOffset: number, pageOffsets: number[]): number {
  // 二分查找
  let lo = 0;
  let hi = pageOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pageOffsets[mid]! <= charOffset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

// ─── §4.6 上下文首句提取 ───

const SENTENCE_END_RE = /^(.+?[.!?。！？])(?:\s|$)/;

function extractFirstSentence(text: string): string {
  const match = SENTENCE_END_RE.exec(text.trim());
  if (match) return match[1]!;
  return text.trim().slice(0, 100);
}

// ─── §4.2 段落分割 ───

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

// ─── §4.2 段落偏移量预计算（Fix #2） ───

/** 计算每个段落在 sectionText 中的起始字符偏移 */
function computeParagraphOffsets(sectionText: string, paragraphs: string[]): number[] {
  const offsets: number[] = [];
  let searchFrom = 0;
  for (const para of paragraphs) {
    const idx = sectionText.indexOf(para, searchFrom);
    if (idx >= 0) {
      offsets.push(idx);
      searchFrom = idx + para.length;
    } else {
      // fallback: 使用当前搜索位置
      offsets.push(searchFrom);
      searchFrom += para.length;
    }
  }
  return offsets;
}

// ─── §4.2 extractTailTokens（Fix #4: 二分搜索精确定位） ───

function extractTailTokens(text: string, targetTokens: number): string {
  const totalTokens = countTokens(text);
  if (totalTokens <= targetTokens) return text;

  // 二分搜索：找到使得 text.slice(mid) 的 token 数 <= targetTokens 的最小 mid
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const tailTokens = countTokens(text.slice(mid));
    if (tailTokens > targetTokens) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return text.slice(lo);
}

// ─── §4.2 forceSplitByTokens（Fix #3: 防御性检查） ───

function forceSplitByTokens(
  text: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  // Fix #3: 防御性检查
  if (overlapTokens >= maxTokens / 2) {
    throw new Error(
      `overlapTokens (${overlapTokens}) must be < maxTokens/2 (${maxTokens / 2})`,
    );
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const tokens = countTokens(remaining);
    if (tokens <= maxTokens) {
      chunks.push(remaining);
      break;
    }

    // 近似截断点
    const ratio = maxTokens / tokens;
    let cutPoint = Math.floor(remaining.length * ratio);

    // 在 ±5% 范围内搜索句子边界
    const searchRange = Math.floor(remaining.length * 0.05);
    const searchStart = Math.max(0, cutPoint - searchRange);
    const searchEnd = Math.min(remaining.length, cutPoint + searchRange);
    const searchSlice = remaining.slice(searchStart, searchEnd);

    const sentenceEnd = /[.!?。！？;；]\s/.exec(searchSlice);
    if (sentenceEnd) {
      cutPoint = searchStart + sentenceEnd.index! + sentenceEnd[0].length;
    }

    chunks.push(remaining.slice(0, cutPoint));

    // Overlap
    const overlapText = extractTailTokens(remaining.slice(0, cutPoint), overlapTokens);
    remaining = overlapText + remaining.slice(cutPoint);
  }

  return chunks;
}

// ─── SectionLabel → SectionType 映射 ───

const LABEL_TO_TYPE: Record<SectionLabel, SectionType | null> = {
  abstract: 'introduction',
  introduction: 'introduction',
  background: 'theory',
  literature_review: 'literature_review',
  method: 'methods',
  results: 'results',
  discussion: 'discussion',
  conclusion: 'conclusion',
  appendix: 'methods',
  unknown: null,
};

// ─── 工具：从 SectionMap | SectionMapV2 统一读取 ───

interface SectionData {
  label: SectionLabel;
  text: string;
  charStart: number | null;
}

function extractSectionDataList(
  sectionMap: SectionMap | SectionMapV2,
  boundaries: SectionBoundaryList,
): SectionData[] {
  const result: SectionData[] = [];
  for (const [label, value] of sectionMap) {
    if (typeof value === 'string') {
      // 旧版 SectionMap
      const boundary = boundaries.find((b) => b.label === label);
      result.push({
        label,
        text: value,
        charStart: boundary?.charStart ?? null,
      });
    } else {
      // SectionMapV2 (SectionEntry)
      result.push({
        label,
        text: (value as SectionEntry).text,
        charStart: (value as SectionEntry).charStart,
      });
    }
  }
  return result;
}

// ─── §4.1 chunkText 主函数 ───

export interface ChunkTextOptions {
  paperId?: PaperId | null | undefined;
  maxTokensPerChunk?: number | undefined;
  overlapTokens?: number | undefined;
  source?: ChunkSource | undefined;
  chunkIdPrefix?: string | undefined;
}

export function chunkText(
  sectionMap: SectionMap | SectionMapV2,
  boundaries: SectionBoundaryList,
  pageTexts: string[],
  options: ChunkTextOptions = {},
): TextChunk[] {
  const paperId = options.paperId ?? null;
  const maxTokens = options.maxTokensPerChunk ?? 1024;
  const overlapTokens = options.overlapTokens ?? 128;
  const source = options.source ?? 'paper';

  // Fix #3: 入口处防御性检查
  if (overlapTokens >= maxTokens / 2) {
    throw new Error(
      `overlapTokens (${overlapTokens}) must be < maxTokens/2 (${maxTokens / 2})`,
    );
  }

  const fullText = pageTexts.join('\n\n');
  const pageOffsets = buildPageOffsets(pageTexts);
  const results: TextChunk[] = [];

  // 用于 indexOf fallback 的字符偏移追踪
  let globalCharOffset = 0;

  const sections = extractSectionDataList(sectionMap, boundaries);

  for (const section of sections) {
    const { label, text: sectionText } = section;

    // Fix #1: 优先使用 boundary 的 charStart，fallback 到 indexOf
    let sectionStartInFull: number;
    if (section.charStart != null) {
      sectionStartInFull = section.charStart;
    } else {
      const idx = fullText.indexOf(sectionText, globalCharOffset);
      sectionStartInFull = idx >= 0 ? idx : globalCharOffset;
    }
    globalCharOffset = sectionStartInFull;

    // 查找 boundary 信息
    const boundary = boundaries.find((b) => b.label === label);
    const sectionTitle = boundary?.title ?? null;
    const sectionType = LABEL_TO_TYPE[label];

    // Fix #5: 为整个 section 计算统一的 sectionPage
    const sectionPage = pageTexts.length > 0 ? findPage(sectionStartInFull, pageOffsets) : null;

    // §8.2 优化：如果整个 section ≤ maxTokens，作为单个 chunk
    const sectionTokens = countTokens(sectionText);
    if (sectionTokens <= maxTokens) {
      const pageStart = pageTexts.length > 0 ? findPage(sectionStartInFull, pageOffsets) : null;
      const pageEnd = pageTexts.length > 0 ? findPage(sectionStartInFull + sectionText.length, pageOffsets) : null;
      const positionRatio = fullText.length > 0 ? sectionStartInFull / fullText.length : null;

      const chunkId = makeChunkId(paperId, label, sectionPage, 0, source, options.chunkIdPrefix);

      results.push({
        chunkId,
        paperId,
        sectionLabel: label,
        sectionTitle,
        sectionType,
        pageStart,
        pageEnd,
        text: sectionText,
        tokenCount: sectionTokens,
        source,
        positionRatio,
        parentChunkId: null,
        chunkIndex: null,
        contextBefore: null,
        contextAfter: null,
      });
      continue;
    }

    // §4.2 段落级子分块
    const paragraphs = splitParagraphs(sectionText);
    // Fix #2: 预计算每个段落在 sectionText 中的偏移
    const paraOffsets = computeParagraphOffsets(sectionText, paragraphs);

    const sectionChunks: TextChunk[] = [];
    let currentTexts: string[] = [];
    let currentParaIndices: number[] = []; // 追踪当前 chunk 包含的段落索引
    let currentTokenCount = 0;
    let chunkSeq = 0;

    const emitChunk = (
      texts: string[],
      seq: number,
      ctxBefore: string | null,
      startParaIdx: number, // Fix #2: 使用段落索引计算偏移
    ) => {
      const text = texts.join('\n\n');
      const tokens = countTokens(text);

      // Fix #2: 使用预计算的段落偏移
      const offsetInSection = startParaIdx < paraOffsets.length
        ? paraOffsets[startParaIdx]!
        : 0;
      const absoluteOffset = sectionStartInFull + offsetInSection;

      const pageStart = pageTexts.length > 0 ? findPage(absoluteOffset, pageOffsets) : null;
      const pageEnd = pageTexts.length > 0 ? findPage(absoluteOffset + text.length, pageOffsets) : null;
      const positionRatio = fullText.length > 0 ? absoluteOffset / fullText.length : null;

      // Fix #5: 使用 sectionPage 而非 chunk-specific pageStart 生成 ID
      const chunkId = makeChunkId(paperId, label, sectionPage, seq, source, options.chunkIdPrefix);

      const chunk: TextChunk = {
        chunkId,
        paperId,
        sectionLabel: label,
        sectionTitle,
        sectionType,
        pageStart,
        pageEnd,
        text,
        tokenCount: tokens,
        source,
        positionRatio,
        parentChunkId: null, // Fix #5: 统一在后续循环中设置
        chunkIndex: null,
        contextBefore: ctxBefore,
        contextAfter: null, // 后续填充
      };

      sectionChunks.push(chunk);
    };

    let prevParagraphForContext: string | null = null;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const para = paragraphs[pIdx]!;
      const paraTokens = countTokens(para);

      if (currentTokenCount + paraTokens <= maxTokens) {
        currentTexts.push(para);
        currentParaIndices.push(pIdx);
        currentTokenCount += paraTokens;
      } else {
        if (currentTexts.length > 0) {
          const ctxBefore = prevParagraphForContext
            ? extractFirstSentence(prevParagraphForContext)
            : null;
          const startParaIdx = currentParaIndices[0]!;
          emitChunk(currentTexts, chunkSeq, ctxBefore, startParaIdx);
          chunkSeq++;

          prevParagraphForContext = currentTexts[currentTexts.length - 1]!;

          // Overlap
          const overlapText = extractTailTokens(
            currentTexts.join('\n\n'),
            overlapTokens,
          );
          currentTexts = [overlapText, para];
          currentParaIndices = [currentParaIndices[currentParaIndices.length - 1]!, pIdx];
          currentTokenCount = countTokens(overlapText) + paraTokens;
        } else {
          // 单段落超过 maxTokens
          const subChunks = forceSplitByTokens(para, maxTokens, overlapTokens);
          for (const sub of subChunks) {
            emitChunk([sub], chunkSeq, prevParagraphForContext
              ? extractFirstSentence(prevParagraphForContext) : null, pIdx);
            chunkSeq++;
          }
          prevParagraphForContext = para;
          currentTexts = [];
          currentParaIndices = [];
          currentTokenCount = 0;
        }
      }
    }

    if (currentTexts.length > 0) {
      const ctxBefore = prevParagraphForContext
        ? extractFirstSentence(prevParagraphForContext)
        : null;
      const startParaIdx = currentParaIndices.length > 0 ? currentParaIndices[0]! : 0;
      emitChunk(currentTexts, chunkSeq, ctxBefore, startParaIdx);
    }

    // §4.6: 填充 contextAfter
    for (let i = 0; i < sectionChunks.length - 1; i++) {
      const nextChunk = sectionChunks[i + 1]!;
      const nextParas = splitParagraphs(nextChunk.text);
      if (nextParas.length > 0) {
        sectionChunks[i]!.contextAfter = extractFirstSentence(nextParas[0]!);
      }
    }

    // §4.7: Fix #5 — 统一设置 parentChunkId 和 chunkIndex
    if (sectionChunks.length > 1) {
      const parentId = sectionChunks[0]!.chunkId;
      for (let i = 1; i < sectionChunks.length; i++) {
        sectionChunks[i]!.parentChunkId = parentId;
        sectionChunks[i]!.chunkIndex = i;
      }
    }

    results.push(...sectionChunks);
  }

  return results;
}

// ─── ChunkId 生成 ───

function makeChunkId(
  paperId: PaperId | null,
  label: SectionLabel,
  sectionPage: number | null, // Fix #5: 使用 section 统一的页码
  seq: number,
  source: ChunkSource,
  prefix?: string | undefined,
): ChunkId {
  if (prefix) {
    return asChunkId(seq > 0 ? `${prefix}__${seq}` : prefix);
  }

  const base = paperId
    ? `${paperId}__${label}__${sectionPage ?? 0}`
    : `${source}__${label}__${seq}`;

  return asChunkId(seq > 0 ? `${base}__${seq}` : base);
}
