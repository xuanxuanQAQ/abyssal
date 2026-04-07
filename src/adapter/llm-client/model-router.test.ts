import { describe, it, expect } from 'vitest';
import { ModelRouter, getModelContextWindow, getReasoningEffort, inferProviderForModel } from './model-router';
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
    geminiApiKey: null,
    deepseekApiKey: null,
    semanticScholarApiKey: null,
    openalexApiKey: null,
    openalexEmail: null,
    unpaywallEmail: null,
    cohereApiKey: null,
    jinaApiKey: null,
    siliconflowApiKey: null,
    doubaoApiKey: null,
    kimiApiKey: null,
    webSearchApiKey: null,
    ...overrides,
  };
}

/** Create a ModelRouter with static config (convenience for tests). */
function createRouter(
  llmConfig: LlmConfig = makeConfig(),
  apiKeys: ApiKeysConfig = makeApiKeys(),
) {
  return new ModelRouter({
    getLlmConfig: () => llmConfig,
    getApiKeys: () => apiKeys,
  });
}

describe('ModelRouter', () => {
  describe('resolve', () => {
    it('returns global default when no workflowId', () => {
      const router = createRouter();
      const route = router.resolve();
      expect(route.provider).toBe('anthropic');
      expect(route.model).toBe('claude-sonnet-4-20250514');
    });

    it('uses exact match from workflowOverrides', () => {
      const router = createRouter(
        makeConfig({ workflowOverrides: { analyze: { provider: 'openai', model: 'gpt-4o' } } }),
        makeApiKeys({ openaiApiKey: 'sk-openai' }),
      );
      const route = router.resolve('analyze');
      expect(route.provider).toBe('openai');
      expect(route.model).toBe('gpt-4o');
    });

    it('uses prefix match for sub-stage workflowIds', () => {
      const router = createRouter(
        makeConfig({ workflowOverrides: { analyze: { provider: 'deepseek', model: 'deepseek-chat' } } }),
      );
      const route = router.resolve('analyze.screening');
      expect(route.provider).toBe('deepseek');
    });

    it('uses global default when no workflow override exists', () => {
      const router = createRouter();
      const route = router.resolve('discover');
      expect(route.provider).toBe('anthropic');
      expect(route.model).toBe('claude-sonnet-4-20250514');
    });

    it('accepts legacy discovery/analyze override keys', () => {
      const router = createRouter(
        makeConfig({
          workflowOverrides: {
            discovery: { provider: 'deepseek', model: 'deepseek-chat' },
            analysis: { provider: 'openai', model: 'gpt-4o' },
          },
        } as any),
        makeApiKeys({ deepseekApiKey: 'sk-ds', openaiApiKey: 'sk-openai' }),
      );

      expect(router.resolve('discover')).toEqual({ provider: 'deepseek', model: 'deepseek-chat', reasoning: null });
      expect(router.resolve('analyze.section')).toEqual({ provider: 'openai', model: 'gpt-4o', reasoning: null });
    });
  });

  describe('resolveAndValidate', () => {
    it('throws when provider API key is missing', () => {
      const router = createRouter(
        makeConfig({
          workflowOverrides: { discover: { provider: 'deepseek', model: 'deepseek-chat' } },
        }),
        makeApiKeys({ anthropicApiKey: 'sk-test', deepseekApiKey: null }),
      );
      // discover overridden to deepseek, but deepseekApiKey is null → throws
      expect(() => router.resolveAndValidate('discover')).toThrow(
        /Provider "deepseek" is not configured/,
      );
    });

    it('returns route when API key is present', () => {
      const router = createRouter(
        makeConfig({
          workflowOverrides: { discover: { provider: 'deepseek', model: 'deepseek-chat' } },
        }),
        makeApiKeys({ anthropicApiKey: 'sk-test', deepseekApiKey: 'sk-ds' }),
      );
      const route = router.resolveAndValidate('discover');
      expect(route.provider).toBe('deepseek');
    });

    it('uses global default when no workflow override exists', () => {
      const router = createRouter(
        makeConfig(),
        makeApiKeys({ anthropicApiKey: 'sk-test' }),
      );
      const route = router.resolveAndValidate('discover');
      expect(route.provider).toBe('anthropic');
    });

    it('local models (vllm) always pass availability check', () => {
      const router = createRouter(
        makeConfig({ workflowOverrides: { analyze: { provider: 'vllm', model: 'qwen2.5:14b' } } }),
        makeApiKeys({ anthropicApiKey: null }), // no API keys at all
      );
      const route = router.resolveAndValidate('analyze');
      expect(route.provider).toBe('vllm');
    });
  });

  describe('config hot-reload', () => {
    it('picks up provider changes immediately via getter', () => {
      let llmConfig = makeConfig({ defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4' });
      const apiKeys = makeApiKeys({ anthropicApiKey: 'sk-a', deepseekApiKey: 'sk-d' });

      const router = new ModelRouter({
        getLlmConfig: () => llmConfig,
        getApiKeys: () => apiKeys,
      });

      // Initial: anthropic
      expect(router.resolve().provider).toBe('anthropic');
      expect(router.resolve().model).toBe('claude-sonnet-4');

      // Simulate settings change
      llmConfig = makeConfig({ defaultProvider: 'deepseek', defaultModel: 'deepseek-chat' });

      // Router immediately sees the new config
      expect(router.resolve().provider).toBe('deepseek');
      expect(router.resolve().model).toBe('deepseek-chat');
    });

    it('picks up API key changes for validation', () => {
      const llmConfig = makeConfig({
        workflowOverrides: { discover: { provider: 'deepseek', model: 'deepseek-chat' } },
      });
      let apiKeys = makeApiKeys({ anthropicApiKey: 'sk-a', deepseekApiKey: null });

      const router = new ModelRouter({
        getLlmConfig: () => llmConfig,
        getApiKeys: () => apiKeys,
      });

      // discover overridden to deepseek, but no deepseek key → throws
      expect(() => router.resolveAndValidate('discover')).toThrow(/not configured/);

      // Add deepseek key
      apiKeys = makeApiKeys({ anthropicApiKey: 'sk-a', deepseekApiKey: 'sk-d' });

      // Now deepseek is available
      expect(router.resolveAndValidate('discover').provider).toBe('deepseek');
    });

    it('picks up workflowOverride changes', () => {
      let llmConfig = makeConfig();
      const apiKeys = makeApiKeys({ openaiApiKey: 'sk-o' });

      const router = new ModelRouter({
        getLlmConfig: () => llmConfig,
        getApiKeys: () => apiKeys,
      });

      // Initially no override for 'analyze' → builtin (anthropic)
      expect(router.resolve('analyze').provider).toBe('anthropic');

      // Add override
      llmConfig = makeConfig({
        workflowOverrides: { analyze: { provider: 'openai', model: 'gpt-4o' } },
      });

      expect(router.resolve('analyze').provider).toBe('openai');
      expect(router.resolve('analyze').model).toBe('gpt-4o');
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

describe('inferProviderForModel', () => {
  it('infers anthropic for Claude models', () => {
    expect(inferProviderForModel('claude-opus-4')).toBe('anthropic');
  });

  it('infers openai for GPT and o-series models', () => {
    expect(inferProviderForModel('gpt-4o')).toBe('openai');
    expect(inferProviderForModel('o3-mini')).toBe('openai');
  });

  it('infers deepseek for DeepSeek models', () => {
    expect(inferProviderForModel('deepseek-chat')).toBe('deepseek');
  });

  it('infers gemini for Gemini models', () => {
    expect(inferProviderForModel('gemini-3.1-pro-preview')).toBe('gemini');
  });

  it('returns null for unknown local model names', () => {
    expect(inferProviderForModel('llama3')).toBeNull();
  });
});
