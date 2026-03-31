/**
 * Suggestion formatter — LLM-powered condensation of raw suggestions
 * into 3-5 actionable natural language items + action parameter attachment.
 *
 * See spec: section 6.4–6.5
 */

import type { RawSuggestion } from './diagnostic-queries';
import type { FormattedSuggestion } from './suggestion-types';
import type { LlmClient, CompletionResult } from '../llm-client/llm-client';

export type { FormattedSuggestion } from './suggestion-types';

// ─── Format with LLM (§6.4) ───

/**
 * Use a lightweight LLM (DeepSeek-Chat) to organize raw suggestions
 * into 3-5 prioritized natural language suggestions.
 *
 * The action parameter comes from the original RawSuggestion — NOT from
 * the LLM — to prevent hallucinated operations.
 */
export async function formatSuggestionsWithLlm(
  rawSuggestions: RawSuggestion[],
  llmClient: LlmClient,
  projectStats: { papers: number; concepts: number; memos: number },
): Promise<FormattedSuggestion[]> {
  if (rawSuggestions.length === 0) return [];

  const systemPrompt = `You are a research project advisor. Based on the diagnostic data below,
produce 3-5 actionable suggestions for the researcher, ordered by priority.
Each suggestion should be 1-2 sentences.

Diagnostic summary:
${JSON.stringify(rawSuggestions.map((s) => ({ type: s.type, priority: s.priority, title: s.title })), null, 2)}

Project statistics: ${JSON.stringify(projectStats)}

Output format (JSON array):
[
  {
    "title": "brief title",
    "description": "1-2 sentence description",
    "rawSuggestionIndex": 0
  }
]`;

  try {
    const result: CompletionResult = await llmClient.complete({
      systemPrompt,
      messages: [{ role: 'user', content: 'Generate suggestions based on the diagnostic data.' }],
      maxTokens: 1024,
      temperature: 0.3,
      workflowId: 'advisory',
    });

    const parsed = parseFormatterOutput(result.text);
    return parsed.map((item) => {
      const raw = rawSuggestions[item.rawSuggestionIndex] ?? rawSuggestions[0]!;
      return {
        title: item.title,
        description: item.description,
        priority: raw.priority,
        action: raw.action, // Action from RawSuggestion, not LLM
        diagnosticSource: raw.diagnosticSource ?? raw.type,
      };
    });
  } catch {
    // LLM formatting failed — fall back to raw suggestions as-is
    return rawSuggestions.slice(0, 5).map((s) => ({
      title: s.title,
      description: s.title,
      priority: s.priority,
      action: s.action,
      diagnosticSource: s.diagnosticSource ?? s.type,
    }));
  }
}

// ─── Without LLM (rule-engine only fallback) ───

export function formatSuggestionsWithoutLlm(rawSuggestions: RawSuggestion[]): FormattedSuggestion[] {
  // Sort by priority (high > medium > low), take top 5
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...rawSuggestions].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
  return sorted.slice(0, 5).map((s) => ({
    title: s.title,
    description: s.title,
    priority: s.priority,
    action: s.action,
    diagnosticSource: s.diagnosticSource ?? s.type,
  }));
}

// ─── Output parsing ───

interface FormatterItem {
  title: string;
  description: string;
  rawSuggestionIndex: number;
}

function parseFormatterOutput(text: string): FormatterItem[] {
  // Try to extract JSON array from LLM output
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const arr = JSON.parse(jsonMatch[0]) as FormatterItem[];
    return arr.filter(
      (item) => typeof item.title === 'string' && typeof item.description === 'string',
    );
  } catch {
    return [];
  }
}
