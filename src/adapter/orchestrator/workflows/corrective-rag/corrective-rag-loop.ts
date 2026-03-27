/**
 * Corrective RAG Loop — orchestrates retrieval quality validation with retry.
 *
 * Wraps core/rag/corrective-rag.ts validateRetrieval with:
 * - Max 2 retry attempts (§1.5)
 * - Three repair branches: query rewrite / score threshold raise / top-K expand
 * - Evidence gap collection across attempts
 * - QualityReport construction
 *
 * See spec: §1
 */

import type { RankedChunk } from '../../../../core/types/chunk';
import type { Logger } from '../../../../core/infra/logger';
import {
  buildQualityReport,
  defaultPassReport,
  type QualityReport,
  type EvaluationResult,
} from './quality-report';

// ─── Types ───

export type LlmCallFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface RetrieveFn {
  (query: string, options: Record<string, unknown>): Promise<RankedChunk[]>;
}

export interface CragLoopOptions {
  maxAttempts?: number;
  retrievalOptions: Record<string, unknown>;
  enabled?: boolean;
}

export interface CragLoopResult {
  chunks: RankedChunk[];
  qualityReport: QualityReport;
  modified: boolean;
}

// ─── Evaluation prompt (§1.3) ───

const EVAL_SYSTEM_PROMPT = `You are a retrieval quality evaluator for an academic research system.
Assess whether the retrieved passages are adequate for the given task.

Output ONLY a JSON object with the following fields:
{
  "coverage": "sufficient" | "partial" | "insufficient",
  "relevance": "high" | "moderate" | "low",
  "sufficiency": "sufficient" | "insufficient",
  "suggested_query": "...",
  "suggested_filter": "...",
  "gaps": ["...", "..."]
}`;

// ─── Main loop (§1.5) ───

/**
 * Execute the Corrective RAG evaluation loop.
 *
 * @param chunks - Initial retrieval results
 * @param query - Original query text
 * @param taskDescription - Description of the downstream task
 * @param llmCall - Lightweight LLM function for evaluation
 * @param retrieveFn - Re-retrieval function for query rewrite / top-K expansion
 * @param options - Loop configuration
 * @param logger - Logger instance
 */
export async function correctiveRagLoop(
  chunks: RankedChunk[],
  query: string,
  taskDescription: string,
  llmCall: LlmCallFn,
  retrieveFn: RetrieveFn,
  options: CragLoopOptions,
  logger: Logger,
): Promise<CragLoopResult> {
  if (options.enabled === false) {
    return { chunks, qualityReport: defaultPassReport(), modified: false };
  }

  // No candidates → insufficient
  if (chunks.length === 0) {
    return {
      chunks,
      qualityReport: buildQualityReport(
        { coverage: 'insufficient', relevance: 'high', sufficiency: 'insufficient', suggestedQuery: null, suggestedFilter: null, gaps: ['No retrieval candidates available'] },
        0, ['No retrieval candidates available'],
        { queryRewritten: false, rewrittenQuery: null, topKExpanded: false, scoreThresholdRaised: false },
      ),
      modified: false,
    };
  }

  const maxAttempts = options.maxAttempts ?? 2;
  let currentChunks = chunks;
  let currentQuery = query;
  let attempt = 0;
  const allGaps: string[] = [];
  const actions = { queryRewritten: false, rewrittenQuery: null as string | null, topKExpanded: false, scoreThresholdRaised: false };

  while (attempt < maxAttempts) {
    // ── Evaluate retrieval quality ──
    const evaluation = await evaluateRetrieval(currentChunks, currentQuery, taskDescription, llmCall, logger);

    // ── All pass → exit ──
    if (evaluation.coverage !== 'insufficient' &&
        evaluation.relevance !== 'low' &&
        evaluation.sufficiency === 'sufficient') {
      return {
        chunks: currentChunks,
        qualityReport: buildQualityReport(evaluation, attempt, allGaps, actions),
        modified: attempt > 0,
      };
    }

    // ── Apply repair ──
    let modified = false;

    // Repair 1: coverage insufficient → query rewrite
    if (evaluation.coverage === 'insufficient' && evaluation.suggestedQuery) {
      logger.info('CRAG: rewriting query', { original: currentQuery, suggested: evaluation.suggestedQuery, attempt: attempt + 1 });
      currentQuery = evaluation.suggestedQuery;
      currentChunks = await retrieveFn(currentQuery, options.retrievalOptions);
      actions.queryRewritten = true;
      actions.rewrittenQuery = currentQuery;
      modified = true;
    }
    // Repair 2: relevance low → raise score threshold
    else if (evaluation.relevance === 'low') {
      const threshold = 0.4 + attempt * 0.15;
      logger.info('CRAG: raising score threshold', { threshold, attempt: attempt + 1 });
      currentChunks = currentChunks.filter((c) => c.score >= threshold);
      actions.scoreThresholdRaised = true;
      modified = true;
    }
    // Repair 3: sufficiency insufficient → expand top-K
    else if (evaluation.sufficiency === 'insufficient') {
      const expandedTopK = ((options.retrievalOptions['topK'] as number) ?? 20) * 2;
      logger.info('CRAG: expanding top-K', { expandedTopK, attempt: attempt + 1 });
      currentChunks = await retrieveFn(currentQuery, { ...options.retrievalOptions, topK: expandedTopK });
      actions.topKExpanded = true;
      modified = true;
    }

    allGaps.push(...evaluation.gaps);

    if (!modified) break;
    attempt++;
  }

  // ── Final evaluation ──
  const finalEval = await evaluateRetrieval(currentChunks, currentQuery, taskDescription, llmCall, logger);
  allGaps.push(...finalEval.gaps);

  return {
    chunks: currentChunks,
    qualityReport: buildQualityReport(finalEval, attempt, [...new Set(allGaps)], actions),
    modified: attempt > 0,
  };
}

// ─── Evaluate retrieval (§1.3-1.4) ───

async function evaluateRetrieval(
  chunks: RankedChunk[],
  query: string,
  taskDescription: string,
  llmCall: LlmCallFn,
  logger: Logger,
): Promise<EvaluationResult> {
  const passageLines = chunks.slice(0, 20).map((c, i) => {
    const title = c.displayTitle ?? c.paperId ?? 'unknown';
    const section = c.sectionTitle ?? c.sectionType ?? '';
    return `--- Passage ${i + 1} ---\nSource: ${title}\nSection: ${section}\nScore: ${c.score.toFixed(3)}\nText (first 200 chars): ${c.text.slice(0, 200)}...`;
  }).join('\n\n');

  const userMessage = `## Task Description\n${taskDescription}\n\n## Original Query\n${query}\n\n## Retrieved Passages (${chunks.length} total)\n${passageLines}\n\n## Evaluation Questions\n1. Coverage: Do these passages cover the core intent of the task?\n2. Relevance: Are there passages that seem off-topic?\n3. Sufficiency: Is there enough evidence to write a substantive response?\n\nRespond with the JSON object only.`;

  try {
    const output = await llmCall(EVAL_SYSTEM_PROMPT, userMessage);
    return parseEvaluation(output);
  } catch (err) {
    logger.warn('CRAG evaluation failed, defaulting to pass', { error: (err as Error).message });
    return defaultPass();
  }
}

// ─── Parse evaluation (§1.4) ───

function parseEvaluation(text: string): EvaluationResult {
  try {
    const jsonStr = extractBalancedJson(text);
    if (!jsonStr) return defaultPass();

    const result = JSON.parse(jsonStr) as Record<string, unknown>;

    const validCoverage = ['sufficient', 'partial', 'insufficient'];
    const validRelevance = ['high', 'moderate', 'low'];
    const validSufficiency = ['sufficient', 'insufficient'];

    return {
      coverage: validCoverage.includes(result['coverage'] as string) ? result['coverage'] as EvaluationResult['coverage'] : 'sufficient',
      relevance: validRelevance.includes(result['relevance'] as string) ? result['relevance'] as EvaluationResult['relevance'] : 'high',
      sufficiency: validSufficiency.includes(result['sufficiency'] as string) ? result['sufficiency'] as EvaluationResult['sufficiency'] : 'sufficient',
      suggestedQuery: typeof result['suggested_query'] === 'string' ? result['suggested_query'] : null,
      suggestedFilter: result['suggested_filter'] as string ?? null,
      gaps: Array.isArray(result['gaps']) ? result['gaps'] as string[] : [],
    };
  } catch {
    return defaultPass();
  }
}

function defaultPass(): EvaluationResult {
  return { coverage: 'sufficient', relevance: 'high', sufficiency: 'sufficient', suggestedQuery: null, suggestedFilter: null, gaps: [] };
}

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
