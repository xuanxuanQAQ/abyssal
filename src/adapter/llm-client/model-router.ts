/**
 * Model router — stage-level routing from workflowId to { provider, model }.
 *
 * Resolution order:
 * 1. Exact match in config.llm.workflowOverrides
 * 2. Prefix match (workflowId.split('.')[0])
 * 3. Built-in default mapping table
 * 4. Global default (config.llm.defaultProvider + defaultModel)
 *
 * See spec: section 4 — ModelRouter
 */

import type { LlmConfig, ApiKeysConfig } from '../../core/types/config';

// ─── Types ───

export interface ModelRoute {
  provider: string;
  model: string;
}

// ─── Built-in default mapping (§4.2) ───

const BUILTIN_DEFAULTS: Record<string, ModelRoute> = {
  discover:        { provider: 'deepseek',  model: 'deepseek-chat' },
  analyze:         { provider: 'anthropic',  model: 'claude-opus-4' },
  synthesize:      { provider: 'anthropic',  model: 'claude-opus-4' },
  article:         { provider: 'anthropic',  model: 'claude-opus-4' },
  corrective_rag:  { provider: 'deepseek',  model: 'deepseek-chat' },
  advisory:        { provider: 'deepseek',  model: 'deepseek-chat' },
  agent:           { provider: 'anthropic',  model: 'claude-sonnet-4' },
  vision:          { provider: 'anthropic',  model: 'claude-sonnet-4' },
};

// ─── o3 reasoning_effort mapping ───

export function getReasoningEffort(workflowId: string): 'low' | 'medium' | 'high' | null {
  const prefix = workflowId.split('.')[0] ?? '';
  switch (prefix) {
    case 'discover': return 'low';
    case 'analyze': return workflowId.includes('axiom') ? 'high' : 'medium';
    default: return null;
  }
}

// ─── Known context windows ───

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4':    200_000,
  'claude-sonnet-4':  200_000,
  'gpt-4o':           128_000,
  'gpt-4o-mini':      128_000,
  'o3':               200_000,
  'o3-mini':          200_000,
  'deepseek-chat':    128_000,
  'deepseek-reasoner': 64_000,
};

export function getModelContextWindow(model: string): number {
  for (const [prefix, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(prefix)) return window;
  }
  // Conservative default for unknown/local models
  return 8192;
}

// ─── Provider → API key field mapping ───

const PROVIDER_KEY_MAP: Record<string, keyof ApiKeysConfig> = {
  anthropic: 'anthropicApiKey',
  openai:    'openaiApiKey',
  deepseek:  'deepseekApiKey',
};

// ─── ModelRouter ───

export class ModelRouter {
  private readonly llmConfig: LlmConfig;
  private readonly apiKeys: ApiKeysConfig;

  constructor(llmConfig: LlmConfig, apiKeys: ApiKeysConfig) {
    this.llmConfig = llmConfig;
    this.apiKeys = apiKeys;
  }

  /**
   * Resolve workflowId to { provider, model }.
   *
   * Four-tier resolution: exact → prefix → builtin → global default.
   */
  resolve(workflowId?: string | null): ModelRoute {
    if (workflowId) {
      // 1. Exact match in config overrides
      const exact = this.llmConfig.workflowOverrides[workflowId];
      if (exact) return { provider: exact.provider, model: exact.model };

      // 2. Prefix match
      const prefix = workflowId.split('.')[0]!;
      const prefixMatch = this.llmConfig.workflowOverrides[prefix];
      if (prefixMatch) return { provider: prefixMatch.provider, model: prefixMatch.model };

      // 3. Built-in defaults
      const builtin = BUILTIN_DEFAULTS[prefix];
      if (builtin) return { ...builtin };
    }

    // 4. Global default
    return {
      provider: this.llmConfig.defaultProvider,
      model: this.llmConfig.defaultModel,
    };
  }

  /**
   * Resolve with availability validation and fallback chain (§4.3).
   *
   * If the target model's API key is missing or provider is unavailable,
   * falls back through: config default → claude-sonnet-4 → throw.
   */
  resolveWithFallback(workflowId?: string | null): ModelRoute {
    const primary = this.resolve(workflowId);
    if (this.isAvailable(primary)) return primary;

    // Fallback 1: global default
    const fallback1: ModelRoute = {
      provider: this.llmConfig.defaultProvider,
      model: this.llmConfig.defaultModel,
    };
    if (this.isAvailable(fallback1)) return fallback1;

    // Fallback 2: hardcoded claude-sonnet-4
    const fallback2: ModelRoute = { provider: 'anthropic', model: 'claude-sonnet-4' };
    if (this.isAvailable(fallback2)) return fallback2;

    // No model available — return primary anyway, let caller handle the error
    return primary;
  }

  /**
   * Check if a model route's provider has the required API key.
   * Local models (ollama/vllm) always pass — they don't need keys.
   */
  private isAvailable(route: ModelRoute): boolean {
    if (route.provider === 'ollama' || route.provider === 'vllm') return true;
    const keyField = PROVIDER_KEY_MAP[route.provider];
    if (!keyField) return false;
    const key = this.apiKeys[keyField];
    return key != null && key !== '';
  }
}
