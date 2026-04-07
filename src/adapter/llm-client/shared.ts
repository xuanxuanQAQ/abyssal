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

// ─── Structured output tier ───

/**
 * Three-tier structured output strategy for OpenAI-compatible providers.
 *
 * - 'native':            response_format json_schema — constrained decoding, 100% schema conformance
 * - 'tool_shim':         synthetic function call with strict: true — constrained decoding via tool
 * - 'json_object_prompt': json_object mode + schema injected into system prompt — best-effort
 */
export type StructuredOutputTier = 'native' | 'tool_shim' | 'json_object_prompt';

// ─── Stream error classification ───

/**
 * Classify errors from LLM API calls into specific stream error codes.
 *
 * Detects content moderation rejections from various providers:
 * - Chinese providers (DeepSeek, Doubao, Kimi, SiliconFlow): "high risk", "sensitive", "安全", "违规", "审核"
 * - Anthropic: "high risk", "safety", "harmful"
 * - OpenAI: "content_filter", "content policy"
 */
export function classifyCreateError(err: unknown): string {
  const status = (err as Record<string, unknown>)['status'] as number | undefined;
  const msg = ((err as Error).message ?? '').toLowerCase();

  if (status === 400) {
    if (msg.includes('risk') || msg.includes('sensitive') || msg.includes('content')
      || msg.includes('safety') || msg.includes('harmful')
      || msg.includes('安全') || msg.includes('违规') || msg.includes('审核')) {
      return 'CONTENT_FILTERED';
    }
    return 'BAD_REQUEST';
  }
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status != null && status >= 500) return 'SERVER_ERROR';
  return 'STREAM_ERROR';
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
