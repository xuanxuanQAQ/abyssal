// ═══ Corrective RAG 循环 ═══
// §7: 验证 prompt → LLM 调用 → JSON 解析 → 决策分支

import type { RankedChunk } from '../types/chunk';
import type { Logger } from '../infra/logger';

// ─── LLM 调用函数接口（依赖注入） ───

export type LlmCallFn = (
  systemPrompt: string,
  userMessage: string,
) => Promise<string>;

// ─── §7.2 验证结果 ───

export interface CorrectionResult {
  action: 'pass' | 'rewrite' | 'expand' | 'filter';
  coverage: 'sufficient' | 'partial' | 'insufficient';
  relevance: 'high' | 'medium' | 'low';
  sufficiency: 'sufficient' | 'partial' | 'insufficient';
  rewrittenQuery: string | null;
  gaps: string[];
  removeIndices: number[];
}

// ─── §7.2 验证 prompt 构建 ───

function buildVerificationPrompt(
  queryText: string,
  taskDescription: string,
  candidates: RankedChunk[],
): string {
  // §7.3: 每个候选截断到前 200 字符，最多 20 个
  const maxCandidates = Math.min(candidates.length, 20);
  const totalTokens = candidates.reduce((s, c) => s + c.tokenCount, 0);

  let passages = '';
  for (let i = 0; i < maxCandidates; i++) {
    const c = candidates[i]!;
    const preview = c.text.slice(0, 200);
    passages += `  [${i}] Source: ${c.displayTitle || 'Unknown'}, Section: ${c.sectionTitle || 'N/A'}\n  ${preview}...\n\n`;
  }

  if (candidates.length > maxCandidates) {
    passages += `  ... and ${candidates.length - maxCandidates} more passages\n`;
  }

  return `You are evaluating the quality of retrieved passages for an academic research task.

Task: ${taskDescription}
Query: ${queryText}

Retrieved passages (${candidates.length} total, ${totalTokens} tokens):
${passages}
Evaluate on three dimensions:
1. COVERAGE: Do the passages collectively cover the core intent of the query?
   (sufficient / partial / insufficient)
2. RELEVANCE: Are there passages that are clearly off-topic or irrelevant?
   (high / medium / low)
3. SUFFICIENCY: Is there enough evidence to support the task?
   (sufficient / partial / insufficient)

If coverage or sufficiency is insufficient, suggest a rewritten query that might find better results.

Respond in JSON format:
{
  "coverage": "sufficient|partial|insufficient",
  "relevance": "high|medium|low",
  "sufficiency": "sufficient|partial|insufficient",
  "rewritten_query": "...",
  "gaps": ["description of gap 1", "description of gap 2"],
  "remove_indices": [3, 7]
}`;
}

// ─── §7.2 validateRetrieval 主函数 ───

export async function validateRetrieval(
  candidates: RankedChunk[],
  queryText: string,
  taskDescription: string,
  llmCall: LlmCallFn,
  logger: Logger,
): Promise<CorrectionResult> {
  const prompt = buildVerificationPrompt(queryText, taskDescription, candidates);

  let responseText: string;
  try {
    responseText = await llmCall(
      'You are an academic research quality evaluator. Respond only in valid JSON.',
      prompt,
    );
  } catch (err) {
    // §7.2 fail-open: LLM 失败时直接通过
    logger.warn('Corrective RAG LLM call failed, passing through', {
      error: (err as Error).message,
    });
    return {
      action: 'pass',
      coverage: 'sufficient',
      relevance: 'high',
      sufficiency: 'sufficient',
      rewrittenQuery: null,
      gaps: [],
      removeIndices: [],
    };
  }

  // JSON 解析
  let parsed: {
    coverage?: string;
    relevance?: string;
    sufficiency?: string;
    rewritten_query?: string;
    gaps?: string[];
    remove_indices?: number[];
  };

  try {
    // 尝试从 markdown code block 中提取 JSON
    const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(responseText);
    const jsonStr = jsonMatch ? jsonMatch[1]! : responseText;
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    // §7.2 fail-open: JSON 解析失败时直接通过
    logger.warn('Corrective RAG JSON parse failed, passing through');
    return {
      action: 'pass',
      coverage: 'sufficient',
      relevance: 'high',
      sufficiency: 'sufficient',
      rewrittenQuery: null,
      gaps: [],
      removeIndices: [],
    };
  }

  const coverage = (parsed.coverage ?? 'sufficient') as CorrectionResult['coverage'];
  const relevance = (parsed.relevance ?? 'high') as CorrectionResult['relevance'];
  const sufficiency = (parsed.sufficiency ?? 'sufficient') as CorrectionResult['sufficiency'];
  const gaps = parsed.gaps ?? [];
  const removeIndices = parsed.remove_indices ?? [];
  const rewrittenQuery = parsed.rewritten_query ?? null;

  // §7.2 步骤 4: 决策分支
  let action: CorrectionResult['action'] = 'pass';

  if (coverage === 'insufficient' && rewrittenQuery) {
    action = 'rewrite';
  } else if (relevance === 'low') {
    action = 'filter';
  } else if (sufficiency === 'insufficient') {
    action = 'expand';
  } else if (coverage === 'partial' && sufficiency === 'partial' && rewrittenQuery) {
    action = 'rewrite';
  }

  return {
    action,
    coverage,
    relevance,
    sufficiency,
    rewrittenQuery,
    gaps,
    removeIndices,
  };
}
