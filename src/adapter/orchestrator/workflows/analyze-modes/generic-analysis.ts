/**
 * Generic Analysis — zero-concept mode where no framework exists.
 *
 * Core output: suggested_new_concepts (with definition + keywords).
 * concept_mappings is always an empty array.
 *
 * Uses analyze-generic.md template which omits concept_mappings
 * from the schema entirely to prevent LLM instruction hallucination.
 *
 * See spec: §5
 */

import type { LlmClient } from '../../../llm-client/llm-client';
import type { WorkflowRunnerContext } from '../../workflow-runner';
import { streamingComplete } from '../streaming-llm-helper';
import type { Logger } from '../../../../core/infra/logger';
import type { BudgetAllocation } from '../../../context-budget/context-budget-manager';
import type { AnnotationForFormat } from '../../../prompt-assembler/section-formatter';
import {
  createPromptAssembler,
} from '../../../prompt-assembler/prompt-assembler';
import {
  parseStructuredAnalyzeOutput,
  ANALYZE_STRUCTURED_RESPONSE_FORMAT,
} from '../analyze-structured-output';
import { countTokens } from '../../../llm-client/token-counter';
import type { NormalizedSuggestion } from '../../../output-parser/suggestion-parser';

// ─── Result type ───

export interface GenericAnalysisResult {
  success: boolean;
  suggestedConcepts: NormalizedSuggestion[];
  body: string;
  summary: string;
  warnings: string[];
  model: string | null;
  rawPath: string | null;
}

// ─── Execute generic analysis (§5) ───

export async function runGenericAnalysis(
  paperId: string,
  paperTitle: string,
  paperType: string,
  fullText: string,
  annotations: Array<Record<string, unknown>>,
  memos: Array<{ text: string; createdAt: string; conceptIds: string[]; paperIds: string[] }>,
  allocation: BudgetAllocation,
  llmClient: LlmClient,
  logger: Logger,
  workspacePath: string,
  workflowId = 'analyze.generic',
  explicitModel?: string,
  outputLanguage?: string,
  signal?: AbortSignal,
  runner?: WorkflowRunnerContext,
): Promise<GenericAnalysisResult> {
  const tokenCounter = { count: (text: string) => countTokens(text) };
  const assembler = createPromptAssembler(tokenCounter, logger);

  // Assemble prompt with zero-concept framework
  const assembled = assembler.assemble({
    taskType: 'analyze',
    allocation,
    frameworkState: 'zero_concepts',
    paperId,
    paperType,
    paperTitle,
    conceptFramework: [], // No concepts
    memos: memos.map((m) => ({
      text: m.text,
      createdAt: m.createdAt,
      conceptIds: m.conceptIds,
      paperIds: m.paperIds,
    })),
    annotations: annotations.map((a) => {
      const entry: AnnotationForFormat = {};
      const page = a['page'];
      if (typeof page === 'number') entry.page = page;
      entry.annotationType = (a['type'] as string) ?? 'highlight';
      entry.selectedText = (a['selectedText'] as string) ?? '';
      const comment = a['comment'] as string | undefined;
      if (comment) entry.comment = comment;
      return entry;
    }),
    paperContent: fullText,
    ragPassages: [],
    outputLanguage,
  });

  // LLM call
  logger.debug(`[generic] Paper ${paperId}: LLM call starting`, {
    systemTokens: countTokens(assembled.systemPrompt),
    userTokens: countTokens(assembled.userMessage),
  });
  const llmStart = Date.now();
  const llmParams = {
    systemPrompt: assembled.systemPrompt,
    messages: [{ role: 'user' as const, content: assembled.userMessage }],
    workflowId,
    responseFormat: ANALYZE_STRUCTURED_RESPONSE_FORMAT,
    ...(explicitModel && { model: explicitModel }),
    ...(signal && { signal }),
  };
  const result = runner
    ? await streamingComplete(llmClient, llmParams, runner)
    : await llmClient.complete(llmParams);
  logger.debug(`[generic] Paper ${paperId}: LLM responded`, {
    model: result.model,
    outputLength: result.text.length,
    latencyMs: Date.now() - llmStart,
  });

  const validated = parseStructuredAnalyzeOutput(result.text, {
    paperId,
    model: result.model,
    workflow: workflowId,
    frameworkState: 'zero_concepts',
    workspaceRoot: workspacePath,
  }, logger);

  if (!validated.success) {
    logger.warn(`[generic] Paper ${paperId}: parse failed`, {
      outputPreview: result.text.slice(0, 300),
      rawPath: validated.rawPath,
    });

    return {
      success: false,
      suggestedConcepts: [],
      body: result.text,
      summary: '',
      warnings: ['Parse failed in generic analysis mode'],
      model: result.model,
      rawPath: validated.rawPath,
    };
  }

  logger.debug(`[generic] Paper ${paperId}: parse succeeded`, {
    suggestedConcepts: validated.suggestedConcepts.length,
    warningCount: validated.warnings.length,
  });

  return {
    success: true,
    suggestedConcepts: validated.suggestedConcepts,
    body: validated.body,
    summary: validated.summary,
    warnings: validated.warnings,
    model: result.model,
    rawPath: validated.rawPath,
  };
}
