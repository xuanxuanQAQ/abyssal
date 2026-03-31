/**
 * ContentSanityChecker — LLM 驱动的内容校验
 *
 * 下载 PDF 并提取文本后，用廉价 LLM 调用判断提取的文本是否真的属于目标论文。
 * 能捕获：付费墙页面、CAPTCHA、错误论文、OCR 乱码等问题。
 *
 * Feature 1 of LLM-enhanced acquire pipeline.
 */

import type { Logger } from '../infra/logger';

// ─── Types ───

export type SanityVerdict = 'pass' | 'paywall' | 'captcha' | 'wrong_paper' | 'corrupted';

export interface SanityCheckResult {
  verdict: SanityVerdict;
  confidence: number;
  explanation: string;
}

export interface SanityCheckInput {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  extractedText: string;
  maxChars: number;
}

/**
 * LLM 调用函数类型。
 * 由外部注入，避免 core 层直接依赖 adapter 层的 LlmClient。
 */
export type LlmCallFn = (systemPrompt: string, userPrompt: string, workflowId: string) => Promise<string>;

// ─── Heuristic Pre-checks ───

const PAYWALL_PATTERNS = [
  /access denied/i,
  /sign in to access/i,
  /purchase this article/i,
  /subscribe to read/i,
  /institutional access/i,
  /buy this article/i,
  /rental options/i,
  /log in via your institution/i,
  /verify you are human/i,
  /captcha/i,
  /please enable javascript/i,
  /enable cookies/i,
  /cloudflare/i,
  /just a moment/i,
];

function heuristicCheck(text: string): SanityCheckResult | null {
  // 文本太短 → corrupted
  if (text.trim().length < 100) {
    return { verdict: 'corrupted', confidence: 0.95, explanation: 'Extracted text too short (<100 chars)' };
  }

  // 高比例乱码字符 → corrupted
  // 包含: ASCII可打印, Latin扩展, CJK, 日文假名, 韩文, 阿拉伯, 泰文, 天城文, 常用标点
  const printableRatio = text.replace(/[^\x20-\x7E\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u1100-\u11ff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/g, '').length / text.length;
  if (printableRatio < 0.5) {
    return { verdict: 'corrupted', confidence: 0.9, explanation: `Low printable char ratio: ${(printableRatio * 100).toFixed(0)}%` };
  }

  // 付费墙/CAPTCHA 关键词
  const snippet = text.slice(0, 3000).toLowerCase();
  for (const pattern of PAYWALL_PATTERNS) {
    if (pattern.test(snippet)) {
      const isCaptcha = /captcha|verify you are human|enable javascript/i.test(snippet);
      return {
        verdict: isCaptcha ? 'captcha' : 'paywall',
        confidence: 0.85,
        explanation: `Heuristic: matched pattern "${pattern.source}" in first 3000 chars`,
      };
    }
  }

  return null;
}

// ─── LLM Prompt ───

const SYSTEM_PROMPT = `You are a PDF content quality validator for an academic paper management system. Given the expected paper metadata (title, authors, year) and the first portion of extracted text from a downloaded PDF, determine whether the text belongs to the expected paper.

Respond with JSON only, no markdown:
{
  "verdict": "pass" | "paywall" | "captcha" | "wrong_paper" | "corrupted",
  "confidence": 0.0-1.0,
  "explanation": "brief reason"
}

Rules:
- "paywall": Text contains login pages, subscription prompts, "Access denied", publisher access walls, "Please purchase", etc.
- "captcha": Text contains CAPTCHA challenges, bot detection, "verify you are human", CloudFlare challenge pages
- "wrong_paper": The title/authors/topic clearly don't match — this is a different paper entirely
- "corrupted": Mostly garbage characters, encoding errors, near-empty text, or OCR gibberish
- "pass": Text appears to be the actual paper content matching the metadata. Partial matches are OK (e.g., abstract matches but can't see full paper title in snippet)

Be lenient with "pass" — if the text looks like a legitimate academic paper and the topic roughly aligns, verdict should be "pass".`;

function buildUserPrompt(input: SanityCheckInput): string {
  const snippet = input.extractedText.slice(0, input.maxChars);
  return `Expected paper:
Title: ${input.title}
Authors: ${input.authors.slice(0, 3).join('; ')}
Year: ${input.year ?? 'unknown'}
DOI: ${input.doi ?? 'none'}

Extracted text (first ${snippet.length} chars):
${snippet}`;
}

// ─── Main Checker ───

export class ContentSanityChecker {
  constructor(
    private readonly llmCall: LlmCallFn | null,
    private readonly logger: Logger,
  ) {}

  async check(input: SanityCheckInput): Promise<SanityCheckResult> {
    this.logger.info('[SanityChecker] Starting check', {
      title: input.title.slice(0, 60),
      textLength: input.extractedText.length,
      maxChars: input.maxChars,
    });

    // 步骤 1：启发式预检（免费、即时）
    const heuristic = heuristicCheck(input.extractedText);
    if (heuristic) {
      this.logger.info('[SanityChecker] Heuristic detected issue', {
        verdict: heuristic.verdict,
        explanation: heuristic.explanation,
      });
      return heuristic;
    }

    // 步骤 2：LLM 深度检查
    if (!this.llmCall) {
      this.logger.debug('[SanityChecker] No LLM available, passing by default');
      return { verdict: 'pass', confidence: 0.5, explanation: 'No LLM available, heuristic passed' };
    }

    try {
      const userPrompt = buildUserPrompt(input);
      const raw = await this.llmCall(SYSTEM_PROMPT, userPrompt, 'acquire_sanity');
      return this.parseResponse(raw);
    } catch (err) {
      this.logger.warn('[SanityChecker] LLM call failed, defaulting to pass', { error: (err as Error).message });
      return { verdict: 'pass', confidence: 0.3, explanation: 'LLM call failed, defaulting to pass' };
    }
  }

  private parseResponse(raw: string): SanityCheckResult {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      const verdicts: SanityVerdict[] = ['pass', 'paywall', 'captcha', 'wrong_paper', 'corrupted'];
      const verdict = verdicts.includes(parsed['verdict'] as SanityVerdict)
        ? (parsed['verdict'] as SanityVerdict)
        : 'pass';
      const confidence = typeof parsed['confidence'] === 'number'
        ? Math.max(0, Math.min(1, parsed['confidence'] as number))
        : 0.5;
      const explanation = typeof parsed['explanation'] === 'string'
        ? (parsed['explanation'] as string)
        : '';

      this.logger.info('[SanityChecker] LLM result', { verdict, confidence, explanation });
      return { verdict, confidence, explanation };
    } catch {
      this.logger.warn('[SanityChecker] Failed to parse LLM response');
      return { verdict: 'pass', confidence: 0.3, explanation: 'Failed to parse LLM response' };
    }
  }
}
