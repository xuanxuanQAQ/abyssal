/**
 * Model router — stage-level routing from workflowId to { provider, model }.
 *
 * Resolution order:
 * 1. Exact match in config.llm.workflowOverrides
 * 2. Prefix match (workflowId.split('.')[0])
 * 3. Global default (config.llm.defaultProvider + defaultModel)
 *
 * Config is read lazily via getter functions so that settings changes
 * propagate immediately without requiring router reconstruction.
 *
 * See spec: section 4 — ModelRouter
 */

import type { LlmConfig, ApiKeysConfig } from '../../core/types/config';

// ─── Types ───

export interface ModelRoute {
  provider: string;
  model: string;
}

/** Getter-based config source — allows ModelRouter to always read latest config. */
export interface ModelRouterConfigSource {
  getLlmConfig: () => LlmConfig;
  getApiKeys: () => ApiKeysConfig;
}

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
  anthropic:   'anthropicApiKey',
  openai:      'openaiApiKey',
  deepseek:    'deepseekApiKey',
  siliconflow: 'siliconflowApiKey',
};

// ─── ModelRouter ───

export class ModelRouter {
  private readonly configSource: ModelRouterConfigSource;

  constructor(configSource: ModelRouterConfigSource) {
    this.configSource = configSource;
  }

  /**
   * Resolve workflowId to { provider, model }.
   *
   * Resolution order: exact override → prefix override → global default.
   */
  resolve(workflowId?: string | null): ModelRoute {
    const llmConfig = this.configSource.getLlmConfig();

    if (workflowId) {
      // 1. Exact match in config overrides
      const exact = llmConfig.workflowOverrides[workflowId];
      if (exact) return { provider: exact.provider, model: exact.model };

      // 2. Prefix match
      const prefix = workflowId.split('.')[0]!;
      const prefixMatch = llmConfig.workflowOverrides[prefix];
      if (prefixMatch) return { provider: prefixMatch.provider, model: prefixMatch.model };
    }

    // 3. Global default (user's explicit choice takes precedence)
    return {
      provider: llmConfig.defaultProvider,
      model: llmConfig.defaultModel,
    };
  }

  /**
   * Resolve and validate that the target provider has a valid API key.
   * Throws if the provider is unavailable — no silent fallback.
   */
  resolveAndValidate(workflowId?: string | null): ModelRoute {
    const apiKeys = this.configSource.getApiKeys();
    const route = this.resolve(workflowId);

    if (!isAvailable(route, apiKeys)) {
      throw new Error(
        `Provider "${route.provider}" is not configured — please set its API key in settings.` +
        (workflowId ? ` (workflow: ${workflowId})` : ''),
      );
    }

    return route;
  }
}

// ─── Helpers (pure functions, no state) ───

/**
 * Check if a model route's provider has the required API key.
 * Local models (ollama/vllm) always pass — they don't need keys.
 */
function isAvailable(route: ModelRoute, apiKeys: ApiKeysConfig): boolean {
  if (route.provider === 'ollama' || route.provider === 'vllm') return true;
  const keyField = PROVIDER_KEY_MAP[route.provider];
  if (!keyField) return false;
  const key = apiKeys[keyField];
  return key != null && key !== '';
}

