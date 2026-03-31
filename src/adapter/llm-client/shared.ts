/**
 * Shared helpers for LLM adapters.
 *
 * Centralizes JSON error recovery and finish-reason mapping
 * that were previously duplicated across Claude and OpenAI adapters.
 */

import { jsonrepair } from 'jsonrepair';

// ─── Finish reason mapping (Claude + OpenAI unified) ───

type FinishReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'content_filter';

const FINISH_REASON_MAP: Record<string, FinishReason> = {
  // Claude stop_reason values
  'end_turn': 'end_turn',
  'tool_use': 'tool_use',
  'max_tokens': 'max_tokens',
  'stop_sequence': 'end_turn',
  'content_filter': 'content_filter',
  // OpenAI finish_reason values
  'stop': 'end_turn',
  'tool_calls': 'tool_use',
  'length': 'max_tokens',
};

/**
 * Map a provider-specific stop/finish reason to unified FinishReason.
 * Works for both Claude (stop_reason) and OpenAI (finish_reason) values.
 */
export function mapFinishReason(reason: string): FinishReason {
  return FINISH_REASON_MAP[reason] ?? 'end_turn';
}

// ─── JSON error recovery ───

/**
 * Parse JSON with automatic error recovery via jsonrepair.
 *
 * Handles: trailing commas, missing brackets, unquoted keys,
 * truncated strings, escaped character issues, and more.
 * Returns empty object on unrecoverable parse failure.
 */
export function safeParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    try {
      return JSON.parse(jsonrepair(json));
    } catch {
      return {};
    }
  }
}
