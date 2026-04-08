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

import type { LlmConfig, ApiKeysConfig, ReasoningConfig } from '../../core/types/config';
import { normalizeWorkflowOverrideKey } from '../../core/config/workflow-override-keys';

const LEGACY_WORKFLOW_OVERRIDE_KEYS: Record<string, string[]> = {
  discover: ['discovery'],
  analyze: ['analysis'],
  article: ['generate'],
};

function lookupWorkflowOverride(
  overrides: LlmConfig['workflowOverrides'],
  workflowKey: string,
) {
  const normalizedKey = normalizeWorkflowOverrideKey(workflowKey);
  const candidates = [workflowKey, normalizedKey, ...(LEGACY_WORKFLOW_OVERRIDE_KEYS[normalizedKey] ?? [])];

  for (const candidate of candidates) {
    const override = overrides[candidate];
    if (override) return override;
  }

  return null;
}

// ─── Types ───

export interface ModelRoute {
  provider: string;
  model: string;
  reasoning?: ResolvedReasoning | null;
}

// ─── Reasoning resolution ───

export interface ResolvedReasoning {
  level: 'low' | 'medium' | 'high';
  budgetTokens?: number;
}

/** Per-workflow reasoning defaults (applied when no explicit config override). */
const WORKFLOW_REASONING_DEFAULTS: Record<string, ResolvedReasoning> = {
  'analyze.full':       { level: 'medium' },
  'analyze.full.axiom': { level: 'high' },
  'synthesize.draft':   { level: 'medium' },
  'article.section':    { level: 'low' },
  'article.crag':       { level: 'low' },
  'synthesize.crag':    { level: 'low' },
};

/**
 * Resolve reasoning config: explicit config > workflow defaults > null.
 */
export function resolveReasoningConfig(
  workflowId: string | undefined,
  configOverride: ReasoningConfig | undefined,
): ResolvedReasoning | null {
  if (configOverride) {
    if (configOverride.level === 'off') return null;
    const resolved: ResolvedReasoning = { level: configOverride.level };
    if (configOverride.budgetTokens != null) resolved.budgetTokens = configOverride.budgetTokens;
    return resolved;
  }
  if (workflowId) {
    const exact = WORKFLOW_REASONING_DEFAULTS[workflowId];
    if (exact) return exact;
    // Prefix match (e.g. 'analyze.full.axiom' → check 'analyze.full')
    const dotIdx = workflowId.lastIndexOf('.');
    if (dotIdx > 0) {
      const prefix = workflowId.slice(0, dotIdx);
      const prefixMatch = WORKFLOW_REASONING_DEFAULTS[prefix];
      if (prefixMatch) return prefixMatch;
    }
  }
  return null;
}

/** Models where reasoning is always on (cannot be disabled). */
export function isAlwaysReasoningModel(model: string): boolean {
  return model.startsWith('o3') || model.startsWith('o4')
    || model === 'deepseek-reasoner'
    || model.includes('DeepSeek-R1')
    || model.includes('kimi-k2-thinking')
    || model.startsWith('doubao-seed');
}

const MODEL_PROVIDER_PREFIXES: Array<{ prefix: string; provider: string }> = [
  { prefix: 'claude', provider: 'anthropic' },
  { prefix: 'gpt-', provider: 'openai' },
  { prefix: 'o1', provider: 'openai' },
  { prefix: 'o3', provider: 'openai' },
  { prefix: 'o4', provider: 'openai' },
  { prefix: 'gemini', provider: 'gemini' },
  { prefix: 'deepseek', provider: 'deepseek' },
  { prefix: 'doubao', provider: 'doubao' },
  { prefix: 'kimi', provider: 'kimi' },
];

/** Getter-based config source — allows ModelRouter to always read latest config. */
export interface ModelRouterConfigSource {
  getLlmConfig: () => LlmConfig;
  getApiKeys: () => ApiKeysConfig;
}

// ─── o3 reasoning_effort mapping ───

/** @deprecated Use resolveReasoningConfig() instead. */
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
  'gemini-3.1-pro-preview': 1_000_000,
  'gemini-3-flash-preview': 1_000_000,
  'deepseek-chat':      128_000,
  'deepseek-reasoner':  128_000,
  'o4-mini':            200_000,
  'doubao-seed':        256_000,
  'doubao':             128_000,
  'kimi-k2.5':          262_144,
  'kimi-k2':            262_144,
};

export function getModelContextWindow(model: string): number {
  for (const [prefix, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(prefix)) return window;
  }
  // Conservative default for unknown/local models
  return 8192;
}

export function inferProviderForModel(model: string): string | null {
  for (const entry of MODEL_PROVIDER_PREFIXES) {
    if (model.startsWith(entry.prefix)) return entry.provider;
  }
  return null;
}

// ─── Provider → API key field mapping ───

const PROVIDER_KEY_MAP: Record<string, keyof ApiKeysConfig> = {
  anthropic:   'anthropicApiKey',
  openai:      'openaiApiKey',
  gemini:      'geminiApiKey',
  deepseek:    'deepseekApiKey',
  siliconflow: 'siliconflowApiKey',
  doubao:      'doubaoApiKey',
  kimi:        'kimiApiKey',
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
      const exact = lookupWorkflowOverride(llmConfig.workflowOverrides, workflowId);
      if (exact) {
        return {
          provider: exact.provider,
          model: exact.model,
          reasoning: resolveReasoningConfig(workflowId, exact.reasoning),
        };
      }

      // 2. Prefix match
      const prefix = workflowId.split('.')[0]!;
      const prefixMatch = lookupWorkflowOverride(llmConfig.workflowOverrides, prefix);
      if (prefixMatch) {
        return {
          provider: prefixMatch.provider,
          model: prefixMatch.model,
          reasoning: resolveReasoningConfig(workflowId, prefixMatch.reasoning),
        };
      }
    }

    // 3. Global default — still resolve reasoning from workflow defaults table
    return {
      provider: llmConfig.defaultProvider,
      model: llmConfig.defaultModel,
      reasoning: resolveReasoningConfig(workflowId ?? undefined, undefined),
    };
  }

  /**
   * Resolve and validate that the target provider has a valid API key.
   * Throws if the provider is unavailable — no silent fallback.
   */
  resolveAndValidate(workflowId?: string | null): ModelRoute {
    const apiKeys = this.configSource.getApiKeys();
    const route = this.resolve(workflowId);

    if (!isAvailableRoute(route, apiKeys)) {
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
 * Local models (vllm) always pass — they don't need keys.
 */
export function isAvailableRoute(route: ModelRoute, apiKeys: ApiKeysConfig): boolean {
  if (route.provider === 'vllm') return true;
  const keyField = PROVIDER_KEY_MAP[route.provider];
  if (!keyField) return false;
  const key = apiKeys[keyField];
  return key != null && key !== '';
}

