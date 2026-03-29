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

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LlmClient } from '../../../llm-client/llm-client';
import type { Logger } from '../../../../core/infra/logger';
import type { BudgetAllocation } from '../../../context-budget/context-budget-manager';
import type { AnnotationForFormat } from '../../../prompt-assembler/section-formatter';
import {
  createPromptAssembler,
} from '../../../prompt-assembler/prompt-assembler';
import {
  parseAndValidate,
  type ParseContext,
} from '../../../output-parser/output-parser';
import { countTokens } from '../../../llm-client/token-counter';
import type { NormalizedSuggestion } from '../../../output-parser/suggestion-parser';

// ─── Result type ───

export interface GenericAnalysisResult {
  success: boolean;
  suggestedConcepts: NormalizedSuggestion[];
  body: string;
  frontmatter: Record<string, unknown> | null;
  warnings: string[];
  strategy: string;
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
      entry.selectedText = (a['selectedText'] as string ?? a['selected_text'] as string) ?? '';
      const comment = a['comment'] as string | undefined;
      if (comment) entry.comment = comment;
      return entry;
    }),
    paperContent: fullText,
    ragPassages: [],
  });

  // LLM call
  const result = await llmClient.complete({
    systemPrompt: assembled.systemPrompt,
    messages: [{ role: 'user', content: assembled.userMessage }],
    workflowId: 'analyze',
  });

  // Parse with validation — no conceptLookup (no concepts exist)
  const parseContext: ParseContext = {
    paperId,
    model: result.model,
  };

  const validated = parseAndValidate(result.text, parseContext, logger);

  if (!validated.success) {
    // Save raw output for diagnosis
    const rawPath = path.join(workspacePath, 'analyses', `${paperId}.raw.txt`);
    try {
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      fs.writeFileSync(rawPath, result.text, 'utf-8');
    } catch { /* ignore */ }

    return {
      success: false,
      suggestedConcepts: [],
      body: result.text,
      frontmatter: null,
      warnings: ['Parse failed in generic analysis mode'],
      strategy: 'parse_failed',
    };
  }

  return {
    success: true,
    suggestedConcepts: validated.suggestedConcepts,
    body: validated.body,
    frontmatter: validated.frontmatter,
    warnings: validated.warnings,
    strategy: validated.strategy,
  };
}
