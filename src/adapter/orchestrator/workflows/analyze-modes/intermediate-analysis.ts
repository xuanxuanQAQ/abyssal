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
): Promise<IntermediateResult | null> {
  // Truncate text for low-cost model (typically smaller context window)
  const truncatedText = fullText.slice(0, 15000);

  const result = await llmClient.complete({
    systemPrompt: INTERMEDIATE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Paper title: ${paperTitle}\n\n${truncatedText}`,
    }],
    workflowId: 'discover_screen', // Use screening slot (low-cost)
  });

  // Parse JSON output
  const parsed = parseIntermediateOutput(result.text, paperId);
  if (!parsed) {
    logger.warn(`Paper ${paperId}: intermediate analysis parse failed`);
    return null;
  }

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

/** String-aware brace balancing for safe JSON extraction. */
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
