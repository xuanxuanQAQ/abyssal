/**
 * Intermediate Analysis — structured metadata extraction using low-cost model.
 *
 * Does NOT produce concept mappings — only extracts paper structure:
 * core_claims, method_summary, key_concepts, potential_relevance.
 *
 * Output is returned to the parent workflow, which owns artifact/report writes
 * and maps the result to a legal paper analysis status.
 *
 * Upgrade path: recommend_deep_analysis=true → queued for full analysis.
 *
 * See spec: §2.2
 */
import type { LlmClient } from '../../../llm-client/llm-client';
import type { WorkflowRunnerContext } from '../../workflow-runner';
import { streamingComplete } from '../streaming-llm-helper';
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
  summary: string;
  body: string;
  model: string | null;
  inputTruncated: boolean;
  truncationMessage: string;
}

// ─── System prompt for intermediate analysis ───

const INTERMEDIATE_SYSTEM_PROMPT = `You are an academic paper screener. Extract structured metadata from the paper below.

Output a JSON object with exactly these fields:
- paper_type: one of "journal", "conference", "theoretical", "review", "preprint", "unknown"
- core_claims: array of {claim, evidence_type, strength}
- method_summary: one paragraph describing methodology
- key_concepts: array of concept name strings
- potential_relevance: float from 0.0 to 1.0
- recommend_deep_analysis: true or false

Be concise. Focus on extracting factual information, not interpretation.`;

// ─── Structured response format for intermediate analysis ───

export const INTERMEDIATE_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  name: 'intermediate_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      paper_type: { type: 'string' },
      core_claims: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            claim: { type: 'string' },
            evidence_type: { type: 'string' },
            strength: { type: 'string' },
          },
          required: ['claim', 'evidence_type', 'strength'],
        },
      },
      method_summary: { type: 'string' },
      key_concepts: {
        type: 'array',
        items: { type: 'string' },
      },
      potential_relevance: { type: 'number' },
      recommend_deep_analysis: { type: 'boolean' },
    },
    required: ['paper_type', 'core_claims', 'method_summary', 'key_concepts', 'potential_relevance', 'recommend_deep_analysis'],
  },
};

// ─── Execute intermediate analysis ───

export async function runIntermediateAnalysis(
  paperId: string,
  fullText: string,
  paperTitle: string,
  llmClient: LlmClient,
  logger: Logger,
  workspacePath: string,
  workflowId = 'analyze.intermediate',
  explicitModel?: string,
  signal?: AbortSignal,
  runner?: WorkflowRunnerContext,
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
  const llmParams = {
    systemPrompt: INTERMEDIATE_SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: `Paper title: ${paperTitle}\n\n${truncatedText}`,
    }],
    workflowId,
    responseFormat: INTERMEDIATE_RESPONSE_FORMAT,
    ...(explicitModel && { model: explicitModel }),
    ...(signal && { signal }),
  };
  const result = runner
    ? await streamingComplete(llmClient, llmParams, runner)
    : await llmClient.complete(llmParams);
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

  const summary = buildIntermediateSummary(parsed);
  const inputTruncated = truncatedText.length < fullText.length;

  return {
    ...parsed,
    summary,
    body: buildIntermediateReport(parsed),
    model: result.model,
    inputTruncated,
    truncationMessage: inputTruncated
      ? `Intermediate analysis truncated paper input from ${fullText.length} to ${truncatedText.length} characters`
      : '',
  };
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
    summary: '',
    body: '',
    model: null,
    inputTruncated: false,
    truncationMessage: '',
  };
}

function buildIntermediateSummary(result: IntermediateResult): string {
  if (result.methodSummary.trim().length > 0) {
    return result.methodSummary.trim().slice(0, 2000);
  }
  if (result.coreClaims.length > 0) {
    return result.coreClaims.map((claim) => claim.claim).join(' ').slice(0, 2000);
  }
  return result.keyConcepts.join(', ').slice(0, 2000);
}

function buildIntermediateReport(result: IntermediateResult): string {
  const lines: string[] = [
    '# Intermediate Analysis',
    '',
    `Paper ID: ${result.paperId}`,
    `Paper Type: ${result.paperType}`,
    `Potential Relevance: ${result.potentialRelevance.toFixed(2)}`,
    `Recommend Deep Analysis: ${result.recommendDeepAnalysis ? 'yes' : 'no'}`,
    '',
  ];

  if (result.methodSummary.trim().length > 0) {
    lines.push('## Method Summary', '');
    lines.push(result.methodSummary.trim(), '');
  }

  if (result.coreClaims.length > 0) {
    lines.push('## Core Claims', '');
    for (const claim of result.coreClaims) {
      lines.push(`- ${claim.claim} (${claim.evidenceType}, ${claim.strength})`);
    }
    lines.push('');
  }

  if (result.keyConcepts.length > 0) {
    lines.push('## Key Concepts', '');
    for (const concept of result.keyConcepts) {
      lines.push(`- ${concept}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

