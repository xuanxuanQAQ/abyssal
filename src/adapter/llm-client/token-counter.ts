/**
 * Model-aware token counter with LRU cache.
 *
 * Wraps src/core/infra/token-counter.ts with:
 * - Model-family → encoder selection (§7.1)
 * - LRU cache (1000 entries, key = first 100 chars + length) (§7.3)
 * - CJK estimation fallback (§7.2)
 *
 * See spec: section 7 — Token Counter
 */

import { countTokens as baseCountTokens } from '../../core/infra/token-counter';

// ─── Encoder selection (§7.1) ───
// js-tiktoken loads cl100k_base globally. For models with different tokenizers
// (DeepSeek, Qwen, etc.), we apply a CJK discount multiplier instead of loading
// separate WASM tokenizer files — avoids ~10MB+ per tokenizer.

type EncoderName = 'cl100k_base' | 'o200k_base';

const MODEL_ENCODER_MAP: Record<string, EncoderName> = {
  'gpt-4o':          'o200k_base',
  'gpt-4o-mini':     'o200k_base',
  'o3':              'o200k_base',
  'o3-mini':         'o200k_base',
  // All others default to cl100k_base
};

/**
 * Resolve the encoder name for a given model.
 * Currently informational only — actual encoding always uses cl100k_base.
 */
export function resolveEncoder(model: string): EncoderName {
  for (const [prefix, encoder] of Object.entries(MODEL_ENCODER_MAP)) {
    if (model.startsWith(prefix)) return encoder;
  }
  return 'cl100k_base';
}

// ─── CJK discount multiplier ───
// cl100k_base over-counts Chinese tokens for models with optimized CJK vocabularies.
// DeepSeek/Qwen tokenizers compress CJK ~40-60% better than cl100k_base.
// We apply a discount to cl100k_base counts for these models to avoid severe
// over-estimation that would cause CBM to prematurely trim useful RAG passages.

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g;

/**
 * Get a correction multiplier for the given model.
 * Returns 1.0 for models whose tokenizer matches cl100k_base (OpenAI, Claude).
 * Returns < 1.0 for models with better CJK compression.
 */
function getCjkDiscount(model: string, text: string): number {
  // Only apply discount for models with optimized CJK tokenizers
  const needsDiscount =
    model.startsWith('deepseek') ||
    model.startsWith('qwen') ||
    model.startsWith('glm') ||
    model.startsWith('yi-') ||
    model.startsWith('vllm/');

  if (!needsDiscount) return 1.0;

  // Only apply discount when text is significantly CJK
  const cjkChars = (text.match(CJK_RANGE) ?? []).length;
  const totalChars = text.length;
  if (totalChars === 0) return 1.0;

  const cjkRatio = cjkChars / totalChars;
  if (cjkRatio < 0.1) return 1.0; // Mostly ASCII — no discount needed

  // Discount scales linearly with CJK ratio:
  // 100% CJK → 0.6 multiplier (DeepSeek tokenizer is ~60% of cl100k for Chinese)
  // 50% CJK  → 0.8 multiplier
  // 10% CJK  → ~0.96 (negligible)
  const maxDiscount = 0.6;
  return 1.0 - (1.0 - maxDiscount) * cjkRatio;
}

// ─── LRU Cache (§7.3) ───

const CACHE_MAX_SIZE = 1000;

function cacheKey(text: string): string {
  // FNV-1a hash + length for collision resistance (replaces prefix-only key)
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + '|' + text.length;
}

class LRUCache<V> {
  private readonly maxSize: number;
  private readonly map = new Map<string, V>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.map.keys().next().value as string;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }
}

const tokenCache = new LRUCache<number>(CACHE_MAX_SIZE);

// ─── Public API ───

/**
 * Count tokens for the given text, with LRU caching and model-aware CJK discount.
 *
 * Uses js-tiktoken (cl100k_base) with automatic CJK estimation fallback.
 * For models with optimized CJK vocabularies (DeepSeek, Qwen, etc.),
 * applies a discount multiplier to avoid 40-60% over-estimation on Chinese text.
 *
 * @param text - Input text
 * @param model - Model identifier (used for CJK discount calculation)
 */
export function countTokens(text: string, model?: string): number {
  // Cache key includes model because discount varies
  const key = model ? `${model}|${cacheKey(text)}` : cacheKey(text);
  const cached = tokenCache.get(key);
  if (cached !== undefined) return cached;

  let count = baseCountTokens(text);

  // Apply CJK discount for models with optimized multilingual tokenizers
  if (model) {
    const discount = getCjkDiscount(model, text);
    if (discount < 1.0) {
      count = Math.ceil(count * discount);
    }
  }

  tokenCache.set(key, count);
  return count;
}

/**
 * Count tokens for multiple texts, returning total.
 */
export function countTokensMulti(texts: string[], model?: string): number {
  return texts.reduce((sum, t) => sum + countTokens(t, model), 0);
}

/**
 * Estimate tokens without encoder (pure heuristic).
 *
 * estimatedTokens = englishWordCount * 1.3 + cjkCharCount * 0.7
 */
export { estimateTokens } from '../../core/infra/token-counter';
