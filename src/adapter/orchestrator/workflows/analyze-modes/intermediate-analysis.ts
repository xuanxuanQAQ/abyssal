/**
 * Intermediate Analysis — structured metadata extraction using low-cost model.
 *
 * Does NOT produce concept mappings — only extracts paper structure:
 * core_claims, method_summary, key_concepts, potential_relevance.
 *
 * Output is written as analyses/{paperId}.intermediate.json.
 * analysis_status = 'intermediate' (not 'completed').
 *
 * Upgrade path: recommend_deep_analysis=true → queued for full analysis.
 *
 * See spec: §2.2
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LlmClient } from '../../../llm-client/llm-client';
import type { Logger } from '../../../../core/infra/logger';
import { extractBalancedJson } from '../../utils';

// ─── Intermediate result schema (§2.2) ───

export interface IntermediateResult {
  paperId: string;
  paperType: string;
  coreClaims: Array<{
    claim: string;
    evidenceType: 'empirical' | 'theoretical' | 'methodological';
    strength: 'strong' | 'moderate' | 'weak';
  }>;
  methodSummary: string;
  keyConcepts: string[];
  potentialRelevance: number;
  recommendDeepAnalysis: boolean;
}

// ─── System prompt for intermediate analysis ───

const INTERMEDIATE_SYSTEM_PROMPT = `You are an academic paper screener. Extract structured metadata from the paper below.

Output a JSON object (NOT YAML) with exactly these fields:
{
  "paper_type": "journal" | "conference" | "theoretical" | "review" | "preprint" | "unknown",
  "core_claims": [
    {"claim": "brief description", "evidence_type": "empirical|theoretical|methodological", "strength": "strong|moderate|weak"}
  ],
  "method_summary": "one paragraph describing methodology",
  "key_concepts": ["concept1", "concept2", ...],
  "potential_relevance": 0.0 to 1.0,
  "recommend_deep_analysis": true | false
}

Be concise. Focus on extracting factual information, not interpretation.`;

// ─── Execute intermediate analysis ───

export async function runIntermediateAnalysis(
  paperId: string,
  fullText: string,
  paperTitle: string,
  llmClient: LlmClient,
  logger: Logger,
  workspacePath: string,
  signal?: AbortSignal,
): Promise<IntermediateResult | null> {
  // Truncate text for low-cost model (typically smaller context window).
  // Use ~15k chars as rough target but avoid cutting mid-sentence.
  const CHAR_LIMIT = 15000;
  let truncatedText = fullText;
  if (fullText.length > CHAR_LIMIT) {
    // Find the last sentence boundary before the limit
    const cutRegion = fullText.slice(CHAR_LIMIT - 200, CHAR_LIMIT + 200);
    const sentenceEnd = cutRegion.search(/[.!?。！？]\s/);
    const cutPoint = sentenceEnd >= 0 ? CHAR_LIMIT - 200 + sentenceEnd + 1 : CHAR_LIMIT;
    truncatedText = fullText.slice(0, cutPoint);
  }

  logger.debug(`[intermediate] Paper ${paperId}: starting intermediate analysis`, {
    paperTitle,
    originalLength: fullText.length,
    truncatedLength: truncatedText.length,
  });

  const llmStart = Date.now();
  const result = await llmClient.complete({
    systemPrompt: INTERMEDIATE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Paper title: ${paperTitle}\n\n${truncatedText}`,
    }],
    workflowId: 'discover_screen', // Use screening slot (low-cost)
    ...(signal && { signal }),
  });
  const llmMs = Date.now() - llmStart;

  logger.debug(`[intermediate] Paper ${paperId}: LLM responded`, {
    model: result.model,
    outputLength: result.text.length,
    latencyMs: llmMs,
  });

  // Parse JSON output
  const parsed = parseIntermediateOutput(result.text, paperId);
  if (!parsed) {
    logger.warn(`[intermediate] Paper ${paperId}: parse failed`, {
      outputPreview: result.text.slice(0, 300),
    });
    return null;
  }

  logger.debug(`[intermediate] Paper ${paperId}: parse succeeded`, {
    paperType: parsed.paperType,
    coreClaimsCount: parsed.coreClaims.length,
    keyConceptsCount: parsed.keyConcepts.length,
    potentialRelevance: parsed.potentialRelevance,
    recommendDeepAnalysis: parsed.recommendDeepAnalysis,
  });

  // Write intermediate result
  const analysesDir = path.join(workspacePath, 'analyses');
  fs.mkdirSync(analysesDir, { recursive: true });
  const outPath = path.join(analysesDir, `${paperId}.intermediate.json`);
  const tmpPath = outPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), 'utf-8');
  fs.renameSync(tmpPath, outPath);

  return parsed;
}

// ─── Parse intermediate output ───

function parseIntermediateOutput(
  text: string,
  paperId: string,
): IntermediateResult | null {
  // Try JSON extraction
  let json: Record<string, unknown> | null = null;

  // Try ```json block
  const codeMatch = text.match(/```json\n([\s\S]*?)```/m);
  if (codeMatch) {
    try { json = JSON.parse(codeMatch[1]!); } catch { /* fall through */ }
  }

  // Try bare JSON with string-aware brace balancing
  if (!json) {
    const balanced = extractBalancedJson(text);
    if (balanced) {
      try { json = JSON.parse(balanced); } catch { /* give up */ }
    }
  }

  if (!json) return null;

  return {
    paperId,
    paperType: String(json['paper_type'] ?? 'unknown'),
    coreClaims: Array.isArray(json['core_claims'])
      ? (json['core_claims'] as Array<Record<string, unknown>>).map((c) => ({
          claim: String(c['claim'] ?? ''),
          evidenceType: (c['evidence_type'] as 'empirical' | 'theoretical' | 'methodological') ?? 'empirical',
          strength: (c['strength'] as 'strong' | 'moderate' | 'weak') ?? 'moderate',
        }))
      : [],
    methodSummary: String(json['method_summary'] ?? ''),
    keyConcepts: Array.isArray(json['key_concepts'])
      ? (json['key_concepts'] as string[]).filter((k) => typeof k === 'string')
      : [],
    potentialRelevance: Math.max(0, Math.min(1, Number(json['potential_relevance']) || 0.5)),
    recommendDeepAnalysis: json['recommend_deep_analysis'] === true,
  };
}

