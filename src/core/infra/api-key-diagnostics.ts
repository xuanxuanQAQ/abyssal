import type { ApiKeysConfig } from '../types/config';
import type { ApiKeyTestResult } from '../../shared-types/models';

export type SupportedApiDiagnosticProvider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'cohere'
  | 'jina'
  | 'siliconflow'
  | 'tavily';

const PROVIDER_KEY_MAP: Record<SupportedApiDiagnosticProvider, keyof ApiKeysConfig | null> = {
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  gemini: 'geminiApiKey',
  deepseek: 'deepseekApiKey',
  cohere: 'cohereApiKey',
  jina: 'jinaApiKey',
  siliconflow: 'siliconflowApiKey',
  tavily: 'webSearchApiKey',
};

export function isSupportedApiDiagnosticProvider(provider: string): provider is SupportedApiDiagnosticProvider {
  return provider in PROVIDER_KEY_MAP;
}

export function getConfiguredApiKey(
  provider: string,
  apiKeys: Partial<ApiKeysConfig>,
): string | null {
  if (!isSupportedApiDiagnosticProvider(provider)) return null;
  const keyName = PROVIDER_KEY_MAP[provider];
  if (!keyName) return null;
  const keyValue = apiKeys[keyName];
  return typeof keyValue === 'string' && keyValue.trim().length > 0 ? keyValue : null;
}

export async function testApiKeyDirect(
  provider: string,
  apiKey: string,
): Promise<ApiKeyTestResult> {
  if (!apiKey) return { ok: false, message: 'No API key provided' };
  if (!isSupportedApiDiagnosticProvider(provider)) {
    return { ok: false, message: `Unknown provider: ${provider}` };
  }

  try {
    switch (provider) {
      case 'anthropic': {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        if (res.ok || res.status === 200) return { ok: true, message: 'Connected' };
        if (res.status === 401) return { ok: false, message: 'Invalid API key' };
        return { ok: true, message: `Status ${res.status} — key likely valid` };
      }
      case 'openai': {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'Connected' }
          : { ok: false, message: `HTTP ${res.status}` };
      }
      case 'gemini': {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'Connected' }
          : { ok: false, message: `HTTP ${res.status}` };
      }
      case 'deepseek': {
        const res = await fetch('https://api.deepseek.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'Connected' }
          : { ok: false, message: `HTTP ${res.status}` };
      }
      case 'cohere': {
        const res = await fetch('https://api.cohere.ai/v1/check-api-key', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'Connected' }
          : { ok: false, message: `HTTP ${res.status}` };
      }
      case 'jina': {
        return { ok: true, message: 'Key configured (no test endpoint)' };
      }
      case 'siliconflow': {
        const res = await fetch('https://api.siliconflow.cn/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'Connected' }
          : { ok: false, message: `HTTP ${res.status}` };
      }
      case 'tavily': {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query: 'test',
            max_results: 1,
            search_depth: 'basic',
          }),
        });
        return res.ok
          ? { ok: true, message: 'Connected' }
          : { ok: false, message: `HTTP ${res.status}` };
      }
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function testConfiguredApiKey(
  provider: string,
  apiKeys: Partial<ApiKeysConfig>,
): Promise<ApiKeyTestResult> {
  const apiKey = getConfiguredApiKey(provider, apiKeys);
  if (!apiKey) return { ok: false, message: 'Key not configured' };
  return testApiKeyDirect(provider, apiKey);
}