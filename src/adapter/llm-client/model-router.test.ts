import { describe, it, expect } from 'vitest';
import { ModelRouter, getModelContextWindow, getReasoningEffort } from './model-router';
import type { LlmConfig, ApiKeysConfig } from '../../core/types/config';

function makeConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    workflowOverrides: {},
    ...overrides,
  };
}

function makeApiKeys(overrides: Partial<ApiKeysConfig> = {}): ApiKeysConfig {
  return {
    anthropicApiKey: 'sk-test',
    openaiApiKey: null,
    deepseekApiKey: null,
    semanticScholarApiKey: null,
    openalexEmail: null,
    unpaywallEmail: null,
    cohereApiKey: null,
    jinaApiKey: null,
    ...overrides,
  };
}

describe('ModelRouter', () => {
  describe('resolve', () => {
    it('returns global default when no workflowId', () => {
      const router = new ModelRouter(makeConfig(), makeApiKeys());
      const route = router.resolve();
      expect(route.provider).toBe('anthropic');
      expect(route.model).toBe('claude-sonnet-4-20250514');
    });

    it('uses exact match from workflowOverrides', () => {
      const router = new ModelRouter(
        makeConfig({ workflowOverrides: { analyze: { provider: 'openai', model: 'gpt-4o' } } }),
        makeApiKeys({ openaiApiKey: 'sk-openai' }),
      );
      const route = router.resolve('analyze');
      expect(route.provider).toBe('openai');
      expect(route.model).toBe('gpt-4o');
    });

    it('uses prefix match for sub-stage workflowIds', () => {
      const router = new ModelRouter(
        makeConfig({ workflowOverrides: { analyze: { provider: 'deepseek', model: 'deepseek-chat' } } }),
        makeApiKeys(),
      );
      const route = router.resolve('analyze.screening');
      expect(route.provider).toBe('deepseek');
    });

    it('falls back to built-in defaults', () => {
      const router = new ModelRouter(makeConfig(), makeApiKeys());
      const route = router.resolve('discover');
      expect(route.provider).toBe('deepseek');
      expect(route.model).toBe('deepseek-chat');
    });
  });

  describe('resolveWithFallback', () => {
    it('falls back to default when primary API key is missing', () => {
      const router = new ModelRouter(
        makeConfig(),
        makeApiKeys({ anthropicApiKey: 'sk-test' }),
      );
      // discover → deepseek, but deepseekApiKey is null
      const route = router.resolveWithFallback('discover');
      // Should fall back to anthropic (has key)
      expect(route.provider).toBe('anthropic');
    });

    it('returns primary route when API key is present', () => {
      const router = new ModelRouter(
        makeConfig(),
        makeApiKeys({ deepseekApiKey: 'sk-ds' }),
      );
      const route = router.resolveWithFallback('discover');
      expect(route.provider).toBe('deepseek');
    });

    it('local models (ollama) always pass availability check', () => {
      const router = new ModelRouter(
        makeConfig({ workflowOverrides: { analyze: { provider: 'ollama', model: 'llama3' } } }),
        makeApiKeys({ anthropicApiKey: null }), // no API keys at all
      );
      const route = router.resolveWithFallback('analyze');
      expect(route.provider).toBe('ollama');
    });
  });
});

describe('getModelContextWindow', () => {
  it('returns known window for Claude models', () => {
    expect(getModelContextWindow('claude-opus-4')).toBe(200_000);
    expect(getModelContextWindow('claude-sonnet-4')).toBe(200_000);
  });

  it('returns known window for GPT models', () => {
    expect(getModelContextWindow('gpt-4o')).toBe(128_000);
  });

  it('returns conservative default for unknown models', () => {
    expect(getModelContextWindow('some-local-model')).toBe(8192);
  });
});

describe('getReasoningEffort', () => {
  it('returns low for discover', () => {
    expect(getReasoningEffort('discover')).toBe('low');
  });

  it('returns medium for analyze', () => {
    expect(getReasoningEffort('analyze')).toBe('medium');
  });

  it('returns high for analyze.axiom', () => {
    expect(getReasoningEffort('analyze.axiom')).toBe('high');
  });

  it('returns null for unsupported workflows', () => {
    expect(getReasoningEffort('article')).toBeNull();
    expect(getReasoningEffort('synthesize')).toBeNull();
  });
});
