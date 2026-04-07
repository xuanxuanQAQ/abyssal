/**
 * Analyze Base Extraction — Stage 1 of Cascading Distillation.
 *
 * Heavy Read, Light Output:
 *   Input:  Full paper text (~30K tokens)
 *   Output: paper_analysis_base (~500-800 tokens of high-density JSON)
 *
 * This stage is concept-independent — it extracts claims, methods,
 * key terms, and contribution summary without any concept framework
 * influence. The output is stable and never invalidated by concept changes.
 *
 * Triggered: on paper import (background) or first access.
 */

import type { LlmClient } from '../../llm-client/llm-client';
import type { Logger } from '../../../core/infra/logger';

// ─── Types ───

export interface BaseExtractionInput {
  paperId: string;
  paperText: string;
  title: string;
  abstract: string | null;
}

export interface BaseExtractionOutput {
  claims: string[];
  methodTags: string[];
  keyTerms: string[];
  contributionSummary: string | null;
}

// ─── Prompt ───

const BASE_EXTRACTION_SYSTEM = `You are an expert academic paper analyst. Extract structured metadata from the paper.

STRICT OUTPUT CONSTRAINTS:
- claims: max 5 items, each ≤80 characters (one-sentence core claims)
- method_tags: max 8 items, each ≤30 characters (methodology labels)
- key_terms: max 15 items, each ≤40 characters (paper's own terminology)
- contribution_summary: max 200 characters

Return ONLY valid JSON. No commentary outside JSON.`;

const BASE_EXTRACTION_USER = `Analyze this paper and extract its structural essence.

Title: {title}
Abstract: {abstract}

Full text:
{text}

Return JSON:
{
  "claims": ["claim1", "claim2", ...],
  "method_tags": ["method1", "method2", ...],
  "key_terms": ["term1", "term2", ...],
  "contribution_summary": "..."
}`;

// ─── Extraction ───

export async function extractAnalysisBase(
  input: BaseExtractionInput,
  llmClient: LlmClient,
  logger: Logger,
): Promise<BaseExtractionOutput> {
  const userPrompt = BASE_EXTRACTION_USER
    .replace('{title}', input.title)
    .replace('{abstract}', input.abstract ?? '(no abstract)')
    .replace('{text}', input.paperText.slice(0, 100_000)); // safety cap

  const response = await llmClient.complete({
    systemPrompt: BASE_EXTRACTION_SYSTEM,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    model: llmClient.resolveModel('analyze.full'),
    temperature: 0.1,
  });

  const content = response.text;

  try {
    const parsed = JSON.parse(content);
    return {
      claims: enforceStringArray(parsed.claims, 5, 80),
      methodTags: enforceStringArray(parsed.method_tags, 8, 30),
      keyTerms: enforceStringArray(parsed.key_terms, 15, 40),
      contributionSummary: typeof parsed.contribution_summary === 'string'
        ? parsed.contribution_summary.slice(0, 200)
        : null,
    };
  } catch (err) {
    logger.warn('Failed to parse base extraction output', {
      paperId: input.paperId,
      error: (err as Error).message,
    });
    return { claims: [], methodTags: [], keyTerms: [], contributionSummary: null };
  }
}

function enforceStringArray(arr: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, maxItems)
    .map((s) => s.trim().slice(0, maxLen));
}
