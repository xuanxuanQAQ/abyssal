/**
 * IntentEmbeddingIndex — embedding-based intent classification fallback.
 *
 * Pre-computes embeddings for curated exemplar sentences per intent.
 * At query time, embeds the user prompt once and finds the nearest
 * intent via L2 distance on L2-normalised vectors.
 *
 * Used as a fallback when keyword-based IntentRouter finds no match.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { EmbedFunction } from '../core/types/common';
import type { CopilotIntent } from './types';
import { l2Distance, l2DistanceToScore } from '../core/infra/vector-math';

// ─── L2 normalisation (self-contained, mirrors core/rag/embedder) ───

function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i]! * vec[i]!;
  }
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i]! / norm;
  }
  return out;
}

// ─── Intent exemplar sentences ───
// Each intent has 5-8 中英文 exemplars covering natural-language variants
// that the keyword regex would miss.

const INTENT_EXEMPLARS: Partial<Record<CopilotIntent, string[]>> = {
  'rewrite-selection': [
    '帮我润色一下这段话',
    '重新措辞这段文字',
    '把这段写得更学术一些',
    'polish this paragraph',
    'rephrase this in a more formal tone',
    '这段表述不太好，帮我改改',
    '让这段话更通顺',
    '能不能用更专业的方式表达',
  ],
  'expand-selection': [
    '把这段展开说说',
    '这里写得太简略了，扩充一下',
    'elaborate on this point',
    'add more detail to this section',
    '能不能把这个论点说得更充分',
    '丰富一下这段内容',
    '多写一些细节',
  ],
  'compress-selection': [
    '这段太啰嗦了，帮我精简',
    '缩短这段话',
    'make this more concise',
    'shorten this paragraph',
    '把这段压缩到两句话',
    '太冗长了，浓缩一下',
  ],
  'continue-writing': [
    '帮我接着往下写',
    '继续写下去',
    'keep writing from here',
    'continue this paragraph',
    '后面该怎么写',
    '接着上面的内容继续',
    '帮我把下文补完',
  ],
  'generate-section': [
    '帮我生成方法论章节',
    '写一个文献综述部分',
    'generate the introduction section',
    'draft the methodology section',
    '帮我写一整节内容',
    '创建一个新章节',
  ],
  'insert-citation-sentence': [
    '帮我加一句带引用的话',
    '写一句引用相关文献的句子',
    'write a sentence citing relevant papers',
    'insert a citation sentence here',
    '用文献支撑一下这个观点',
  ],
  'draft-citation': [
    '帮我加个参考文献',
    '这里需要一个引用',
    'add a citation here',
    'cite a source for this',
    '给这句话找个出处',
    '引用一下相关论文',
  ],
  'summarize-selection': [
    '总结一下我选中的这段',
    '给这段话做个摘要',
    'summarize what I selected',
    'give me a summary of this',
    '概括这段的主要观点',
    '提炼一下核心内容',
  ],
  'summarize-section': [
    '总结一下这一节的内容',
    '给这个章节做个概述',
    'summarize this section for me',
    '归纳这节的要点',
    '简述这一节讲了什么',
  ],
  'review-argument': [
    '这段论证有没有问题',
    '帮我审查一下逻辑',
    'review the argument here',
    'check if the reasoning is sound',
    '这段论述严谨吗',
    '找找这段的逻辑漏洞',
    '有什么论证上的不足吗',
  ],
  'retrieve-evidence': [
    '帮我找找相关的文献证据',
    '有没有支持这个观点的论文',
    'find evidence for this claim',
    'search for related papers',
    '这个说法有什么依据',
    '帮我查一下相关研究',
  ],
  'navigate': [
    '打开图书馆',
    '切换到阅读视图',
    'go to the library view',
    'switch to the reader',
    '跳转到概念图',
    '去写作界面',
  ],
  'run-workflow': [
    '帮我执行发现流程',
    '运行一下论文获取流程',
    'run the discover workflow',
    'start the acquisition pipeline',
    '启动分析工作流',
  ],
  // ── Contrastive: `ask` exemplars ──
  // These anchor generic questions so they don't drift to action intents.
  'ask': [
    '这篇论文的主要贡献是什么',
    '这个概念是什么意思',
    'what does this term mean',
    'explain the methodology',
    '这段话在说什么',
    '这个功能怎么用',
    'what is the difference between these two approaches',
    '已完成编辑器操作是什么意思',
    '帮我解释一下这个结果',
    'can you explain this error message',
    '这篇文章的研究背景是什么',
    'how does this algorithm work',
  ],
};

// ─── Serialised cache format ───

interface CachedIndex {
  dimension: number;
  entries: Array<{
    intent: string;
    text: string;
    vector: number[];
  }>;
}

// ─── Index entry (in-memory) ───

interface IndexEntry {
  intent: CopilotIntent;
  text: string;
  vector: Float32Array;
}

// ─── IntentEmbeddingIndex ───

export class IntentEmbeddingIndex {
  private entries: IndexEntry[] = [];
  private ready = false;
  private warmupPromise: Promise<void> | null = null;
  private dimension = 0;

  constructor(
    private readonly embedFn: EmbedFunction,
    private readonly cacheDir: string,
    private readonly log?: (msg: string, data?: unknown) => void,
  ) {}

  /**
   * Build or load the index. Safe to call multiple times (idempotent).
   * Non-blocking — returns a promise that resolves when the index is usable.
   */
  warmup(): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;
    this.warmupPromise = this.doBuild();
    return this.warmupPromise;
  }

  /** Whether the index has been built and is ready for queries. */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Find the best-matching intent for a user prompt.
   * Returns null if the index isn't ready or no intent exceeds the threshold.
   */
  async match(
    prompt: string,
    threshold = 0.65,
  ): Promise<{ intent: CopilotIntent; score: number } | null> {
    if (!this.ready || this.entries.length === 0) return null;

    let queryVec: Float32Array;
    try {
      const raw = await this.embedFn.embed([prompt]);
      if (!raw[0]) return null;
      queryVec = l2Normalize(raw[0]);
    } catch {
      // Embedding API unavailable — degrade silently
      return null;
    }

    // Brute-force nearest-neighbour (~90 entries, sub-millisecond)
    let bestScore = -1;
    let bestIntent: CopilotIntent = 'ask';
    let bestAskScore = -1; // Track the best `ask` exemplar score separately

    for (const entry of this.entries) {
      const dist = l2Distance(queryVec, entry.vector);
      const score = l2DistanceToScore(dist);
      if (entry.intent === 'ask') {
        if (score > bestAskScore) bestAskScore = score;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIntent = entry.intent;
      }
    }

    // If the best match is `ask` itself, return null (let keyword-miss path handle it)
    if (bestIntent === 'ask') {
      this.log?.('Embedding intent → ask (no action intent)', { bestScore, prompt: prompt.slice(0, 60) });
      return null;
    }

    // Margin check: the action intent must beat the best `ask` score by a margin.
    // This prevents generic questions from drifting to action intents.
    const ASK_MARGIN = 0.05;
    if (bestAskScore >= 0 && bestScore - bestAskScore < ASK_MARGIN) {
      this.log?.('Embedding intent rejected — too close to ask', {
        intent: bestIntent, score: bestScore, askScore: bestAskScore, prompt: prompt.slice(0, 60),
      });
      return null;
    }

    if (bestScore >= threshold) {
      this.log?.('Embedding intent match', { intent: bestIntent, score: bestScore, askScore: bestAskScore, prompt: prompt.slice(0, 60) });
      return { intent: bestIntent, score: bestScore };
    }

    this.log?.('Embedding intent below threshold', { bestScore, threshold, prompt: prompt.slice(0, 60) });
    return null;
  }

  // ─── Internal ───

  private async doBuild(): Promise<void> {
    // Try loading from disk cache first
    const cached = this.loadCache();
    if (cached) {
      this.entries = cached;
      this.dimension = cached[0]?.vector.length ?? 0;
      this.ready = true;
      this.log?.('Intent embedding index loaded from cache', { entries: cached.length, dimension: this.dimension });
      return;
    }

    // Build from scratch: batch-embed all exemplar sentences
    const allTexts: string[] = [];
    const allIntents: CopilotIntent[] = [];

    for (const [intent, texts] of Object.entries(INTENT_EXEMPLARS)) {
      for (const t of texts!) {
        allTexts.push(t);
        allIntents.push(intent as CopilotIntent);
      }
    }

    this.log?.('Building intent embedding index', { exemplars: allTexts.length });

    // Batch in small chunks to avoid 413 from providers with strict payload limits
    const BATCH_SIZE = 16;
    const rawVectors: Float32Array[] = [];
    for (let i = 0; i < allTexts.length; i += BATCH_SIZE) {
      const batch = allTexts.slice(i, i + BATCH_SIZE);
      const batchVectors = await this.embedFn.embed(batch);
      rawVectors.push(...batchVectors);
    }

    this.entries = allTexts.map((text, i) => ({
      intent: allIntents[i]!,
      text,
      vector: l2Normalize(rawVectors[i]!),
    }));

    this.dimension = rawVectors[0]?.length ?? 0;
    this.ready = true;

    // Persist to disk for future starts
    this.saveCache();
    this.log?.('Intent embedding index built and cached', { entries: this.entries.length, dimension: this.dimension });
  }

  private get cachePath(): string {
    return join(this.cacheDir, 'intent-embedding-cache.json');
  }

  private loadCache(): IndexEntry[] | null {
    try {
      if (!existsSync(this.cachePath)) return null;
      const raw = readFileSync(this.cachePath, 'utf-8');
      const data: CachedIndex = JSON.parse(raw);

      // Validate: dimension must be positive (basic sanity)
      if (!data.dimension || data.dimension < 1 || !Array.isArray(data.entries) || data.entries.length === 0) {
        return null;
      }

      return data.entries.map((e) => ({
        intent: e.intent as CopilotIntent,
        text: e.text,
        vector: new Float32Array(e.vector),
      }));
    } catch {
      return null;
    }
  }

  private saveCache(): void {
    try {
      const dir = dirname(this.cachePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: CachedIndex = {
        dimension: this.dimension,
        entries: this.entries.map((e) => ({
          intent: e.intent,
          text: e.text,
          vector: Array.from(e.vector),
        })),
      };
      writeFileSync(this.cachePath, JSON.stringify(data));
    } catch (err) {
      this.log?.('Failed to save intent embedding cache', { error: (err as Error).message });
    }
  }

  /**
   * Invalidate the disk cache (e.g. when embedding model changes).
   * Next warmup() will rebuild from scratch.
   */
  invalidateCache(): void {
    this.ready = false;
    this.entries = [];
    this.warmupPromise = null;
    try {
      if (existsSync(this.cachePath)) {
        const fs = require('node:fs') as typeof import('node:fs');
        fs.unlinkSync(this.cachePath);
      }
    } catch { /* best-effort */ }
  }
}
