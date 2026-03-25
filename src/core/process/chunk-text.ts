// ═══ 结构感知分块引擎 ═══
// §4: Section→段落两层分块 + overlap + 页码映射

import type { PaperId, ChunkId } from '../types/common';
import { asChunkId } from '../types/common';
import type { TextChunk, SectionLabel, SectionType, SectionMap, SectionBoundaryList, ChunkSource } from '../types/chunk';
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

// ─── §4.2 extractTailTokens ───

function extractTailTokens(text: string, targetTokens: number): string {
  const totalTokens = countTokens(text);
  if (totalTokens <= targetTokens * 2) return text;

  // 近似：按字符比例截取尾部
  const ratio = targetTokens / totalTokens;
  const charStart = Math.floor(text.length * (1 - ratio));
  return text.slice(charStart);
}

// ─── §4.2 forceSplitByTokens ───

function forceSplitByTokens(
  text: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
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

    // 在 ±20 token 范围内搜索句子边界
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

// ─── §4.1 chunkText 主函数 ───

export interface ChunkTextOptions {
  paperId?: PaperId | null | undefined;
  maxTokensPerChunk?: number | undefined;
  overlapTokens?: number | undefined;
  source?: ChunkSource | undefined;
  chunkIdPrefix?: string | undefined;
}

export function chunkText(
  sectionMap: SectionMap,
  boundaries: SectionBoundaryList,
  pageTexts: string[],
  options: ChunkTextOptions = {},
): TextChunk[] {
  const paperId = options.paperId ?? null;
  const maxTokens = options.maxTokensPerChunk ?? 1024;
  const overlapTokens = options.overlapTokens ?? 128;
  const source = options.source ?? 'paper';

  const fullText = pageTexts.join('\n\n');
  const pageOffsets = buildPageOffsets(pageTexts);
  const results: TextChunk[] = [];

  // 用于追踪 fullText 内的字符偏移
  let globalCharOffset = 0;

  for (const [label, sectionText] of sectionMap) {
    // 在 fullText 中定位 section 文本的起始偏移
    const sectionStartInFull = fullText.indexOf(sectionText, globalCharOffset);
    if (sectionStartInFull >= 0) {
      globalCharOffset = sectionStartInFull;
    }

    // 查找 boundary 信息
    const boundary = boundaries.find((b) => b.label === label);
    const sectionTitle = boundary?.title ?? null;
    const sectionType = LABEL_TO_TYPE[label];

    // §8.2 优化：如果整个 section ≤ maxTokens，作为单个 chunk
    const sectionTokens = countTokens(sectionText);
    if (sectionTokens <= maxTokens) {
      const startOffset = sectionStartInFull >= 0 ? sectionStartInFull : globalCharOffset;
      const pageStart = pageTexts.length > 0 ? findPage(startOffset, pageOffsets) : null;
      const pageEnd = pageTexts.length > 0 ? findPage(startOffset + sectionText.length, pageOffsets) : null;
      const positionRatio = fullText.length > 0 ? startOffset / fullText.length : null;

      const chunkId = makeChunkId(paperId, label, pageStart, 0, source, options.chunkIdPrefix);

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
    const sectionChunks: TextChunk[] = [];
    let currentTexts: string[] = [];
    let currentTokenCount = 0;
    let chunkSeq = 0;

    const emitChunk = (texts: string[], seq: number, ctxBefore: string | null) => {
      const text = texts.join('\n\n');
      const tokens = countTokens(text);

      // 计算在 fullText 中的偏移
      const chunkTextInSection = text;
      const offsetInSection = sectionText.indexOf(chunkTextInSection);
      const absoluteOffset = (sectionStartInFull >= 0 ? sectionStartInFull : globalCharOffset)
        + (offsetInSection >= 0 ? offsetInSection : 0);

      const pageStart = pageTexts.length > 0 ? findPage(absoluteOffset, pageOffsets) : null;
      const pageEnd = pageTexts.length > 0 ? findPage(absoluteOffset + text.length, pageOffsets) : null;
      const positionRatio = fullText.length > 0 ? absoluteOffset / fullText.length : null;

      const chunkId = makeChunkId(paperId, label, pageStart, seq, source, options.chunkIdPrefix);

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
        parentChunkId: seq > 0 ? makeChunkId(paperId, label, pageStart, 0, source, options.chunkIdPrefix) : null,
        chunkIndex: seq > 0 ? seq : null,
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
        currentTokenCount += paraTokens;
      } else {
        if (currentTexts.length > 0) {
          const ctxBefore = prevParagraphForContext
            ? extractFirstSentence(prevParagraphForContext)
            : null;
          emitChunk(currentTexts, chunkSeq, ctxBefore);
          chunkSeq++;

          prevParagraphForContext = currentTexts[currentTexts.length - 1]!;

          // Overlap
          const overlapText = extractTailTokens(
            currentTexts.join('\n\n'),
            overlapTokens,
          );
          currentTexts = [overlapText, para];
          currentTokenCount = countTokens(overlapText) + paraTokens;
        } else {
          // 单段落超过 maxTokens
          const subChunks = forceSplitByTokens(para, maxTokens, overlapTokens);
          for (const sub of subChunks) {
            emitChunk([sub], chunkSeq, prevParagraphForContext
              ? extractFirstSentence(prevParagraphForContext) : null);
            chunkSeq++;
          }
          prevParagraphForContext = para;
          currentTexts = [];
          currentTokenCount = 0;
        }
      }
    }

    if (currentTexts.length > 0) {
      const ctxBefore = prevParagraphForContext
        ? extractFirstSentence(prevParagraphForContext)
        : null;
      emitChunk(currentTexts, chunkSeq, ctxBefore);
    }

    // §4.6: 填充 contextAfter
    for (let i = 0; i < sectionChunks.length - 1; i++) {
      const nextChunk = sectionChunks[i + 1]!;
      const nextParas = splitParagraphs(nextChunk.text);
      if (nextParas.length > 0) {
        sectionChunks[i]!.contextAfter = extractFirstSentence(nextParas[0]!);
      }
    }

    // §4.7: 修正 parentChunkId
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
  pageStart: number | null,
  seq: number,
  source: ChunkSource,
  prefix?: string | undefined,
): ChunkId {
  if (prefix) {
    return asChunkId(seq > 0 ? `${prefix}__${seq}` : prefix);
  }

  const base = paperId
    ? `${paperId}__${label}__${pageStart ?? 0}`
    : `${source}__${label}__${seq}`;

  return asChunkId(seq > 0 ? `${base}__${seq}` : base);
}
