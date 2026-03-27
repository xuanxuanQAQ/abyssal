import { describe, it, expect } from 'vitest';
import { countTokens, countTokensMulti, resolveEncoder } from './token-counter';

describe('countTokens', () => {
  it('returns consistent results for same text (cache hit)', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const count1 = countTokens(text);
    const count2 = countTokens(text);
    expect(count1).toBe(count2);
    expect(count1).toBeGreaterThan(0);
  });

  it('returns higher count for longer text', () => {
    const short = 'Hello';
    const long = 'Hello world, this is a much longer sentence with many more tokens.';
    expect(countTokens(long)).toBeGreaterThan(countTokens(short));
  });

  it('handles empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('counts Chinese text', () => {
    const chinese = '这是一段中文文本，用于测试中文分词。';
    const count = countTokens(chinese);
    expect(count).toBeGreaterThan(0);
  });
});

describe('CJK discount', () => {
  it('applies 0.6 discount for 100% Chinese text on deepseek model', () => {
    const chinese = '这是一段纯中文文本用于测试分词效果和预算计算准确性';
    const baseCount = countTokens(chinese); // no model → no discount
    const discounted = countTokens(chinese, 'deepseek-chat');
    // Discount should make it smaller (0.6x for 100% CJK)
    expect(discounted).toBeLessThan(baseCount);
    expect(discounted).toBeGreaterThanOrEqual(Math.floor(baseCount * 0.55)); // ~0.6x with rounding
    expect(discounted).toBeLessThanOrEqual(Math.ceil(baseCount * 0.65));
  });

  it('applies no discount for ASCII text on deepseek model', () => {
    const english = 'This is purely English text with no CJK characters at all.';
    const base = countTokens(english);
    const withModel = countTokens(english, 'deepseek-chat');
    expect(withModel).toBe(base);
  });

  it('applies no discount for any text on Claude/GPT models', () => {
    const chinese = '这是一段中文文本';
    const base = countTokens(chinese);
    expect(countTokens(chinese, 'claude-opus-4')).toBe(base);
    expect(countTokens(chinese, 'gpt-4o')).toBe(base);
  });

  it('applies proportional discount for mixed CJK/ASCII text', () => {
    const mixed = 'This paper discusses 可供性理论 and its implications for design.';
    const base = countTokens(mixed);
    const discounted = countTokens(mixed, 'deepseek-chat');
    // Mixed text → partial discount (between 0.6x and 1.0x)
    expect(discounted).toBeLessThanOrEqual(base);
    expect(discounted).toBeGreaterThan(Math.floor(base * 0.5));
  });

  it('cache key includes model to avoid cross-model collision', () => {
    const text = '中文文本测试';
    const base = countTokens(text);
    const deepseek = countTokens(text, 'deepseek-chat');
    // These should be different because discount is applied
    expect(deepseek).toBeLessThan(base);
    // Calling again should return cached values
    expect(countTokens(text)).toBe(base);
    expect(countTokens(text, 'deepseek-chat')).toBe(deepseek);
  });
});

describe('countTokensMulti', () => {
  it('sums token counts across multiple texts', () => {
    const texts = ['Hello world', 'Another sentence'];
    const total = countTokensMulti(texts);
    const individual = countTokens('Hello world') + countTokens('Another sentence');
    expect(total).toBe(individual);
  });

  it('returns 0 for empty array', () => {
    expect(countTokensMulti([])).toBe(0);
  });
});

describe('resolveEncoder', () => {
  it('returns o200k_base for GPT-4o models', () => {
    expect(resolveEncoder('gpt-4o')).toBe('o200k_base');
    expect(resolveEncoder('gpt-4o-mini')).toBe('o200k_base');
  });

  it('returns o200k_base for o3 models', () => {
    expect(resolveEncoder('o3')).toBe('o200k_base');
    expect(resolveEncoder('o3-mini')).toBe('o200k_base');
  });

  it('returns cl100k_base for Claude models', () => {
    expect(resolveEncoder('claude-opus-4')).toBe('cl100k_base');
    expect(resolveEncoder('claude-sonnet-4')).toBe('cl100k_base');
  });

  it('returns cl100k_base for unknown models', () => {
    expect(resolveEncoder('some-unknown-model')).toBe('cl100k_base');
  });
});
