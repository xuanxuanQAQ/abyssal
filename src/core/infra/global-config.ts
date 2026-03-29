/**
 * GlobalConfig — 全局配置管理（存储在 AppData，跨工作区共享）
 *
 * 包含 API 密钥、LLM 默认设置、RAG 后端配置等
 * 不包含工作区级设置（项目名、分析参数等）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GlobalConfig, ApiKeysConfig, LlmConfig, RagConfig, AcquireConfig } from '../types/config';
import {
  DEFAULT_API_KEYS,
  DEFAULT_LLM,
  DEFAULT_RAG,
  DEFAULT_ACQUIRE,
} from './config';

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  apiKeys: DEFAULT_API_KEYS,
  llm: DEFAULT_LLM,
  rag: DEFAULT_RAG,
  acquire: DEFAULT_ACQUIRE,
};

// ═══ TOML 模板 ═══

function defaultGlobalToml(): string {
  return `# Abyssal 全局配置
# 此文件存储跨工作区共享的设置（API 密钥、LLM 偏好等）。
# 修改后重启应用生效。

[apiKeys]
# anthropicApiKey = "sk-ant-..."
# openaiApiKey = "sk-..."
# deepseekApiKey = ""
# semanticScholarApiKey = ""
# openalexEmail = ""
# unpaywallEmail = ""
# cohereApiKey = ""
# jinaApiKey = ""

[llm]
defaultProvider = "anthropic"
defaultModel = "claude-sonnet-4-20250514"

[rag]
embeddingBackend = "api"
embeddingModel = "text-embedding-3-small"
embeddingDimension = 1536
rerankerBackend = "local-bge"
correctiveRagEnabled = true

[acquire]
enabledSources = ["unpaywall", "arxiv", "pmc"]
enableScihub = false
perSourceTimeoutMs = 30000
`;
}

// ═══ 公共接口 ═══

const GLOBAL_CONFIG_FILENAME = 'global-config.toml';

/**
 * 加载全局配置。
 *
 * 优先级：TOML 文件 → 环境变量覆盖 → 默认值
 */
export function loadGlobalConfig(appDataDir: string): GlobalConfig {
  const configPath = path.join(appDataDir, GLOBAL_CONFIG_FILENAME);

  // 如果没有全局配置文件，生成默认文件并返回默认值
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(configPath, defaultGlobalToml(), 'utf-8');
    return applyEnvOverrides({ ...DEFAULT_GLOBAL_CONFIG });
  }

  // 解析 TOML
  let raw: Record<string, unknown>;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const toml = require('smol-toml');
    raw = toml.parse(content) as Record<string, unknown>;
  } catch {
    // 解析失败，使用默认值
    return applyEnvOverrides({ ...DEFAULT_GLOBAL_CONFIG });
  }

  const config: GlobalConfig = {
    apiKeys: {
      ...DEFAULT_API_KEYS,
      ...((raw['apiKeys'] ?? raw['api_keys'] ?? {}) as Record<string, unknown>),
    } as ApiKeysConfig,
    llm: {
      ...DEFAULT_LLM,
      ...((raw['llm'] ?? {}) as Record<string, unknown>),
      workflowOverrides: {
        ...DEFAULT_LLM.workflowOverrides,
        ...(((raw['llm'] as Record<string, unknown>)?.['workflowOverrides'] ?? {}) as Record<string, unknown>),
      },
    } as LlmConfig,
    rag: {
      ...DEFAULT_RAG,
      ...((raw['rag'] ?? {}) as Record<string, unknown>),
    } as RagConfig,
    acquire: {
      ...DEFAULT_ACQUIRE,
      ...((raw['acquire'] ?? {}) as Record<string, unknown>),
    } as AcquireConfig,
  };

  return applyEnvOverrides(config);
}

/**
 * 保存全局配置。
 * 仅更新传入的字段，不覆盖整个文件。
 */
export function saveGlobalConfig(
  appDataDir: string,
  updates: Partial<GlobalConfig>,
): void {
  const configPath = path.join(appDataDir, GLOBAL_CONFIG_FILENAME);
  const current = loadGlobalConfig(appDataDir);

  const merged: GlobalConfig = {
    apiKeys: updates.apiKeys ? { ...current.apiKeys, ...updates.apiKeys } : current.apiKeys,
    llm: updates.llm ? { ...current.llm, ...updates.llm } : current.llm,
    rag: updates.rag ? { ...current.rag, ...updates.rag } : current.rag,
    acquire: updates.acquire ? { ...current.acquire, ...updates.acquire } : current.acquire,
  };

  // 写回 TOML（简化版：写 JSON 注释 + 关键字段）
  // 由于 smol-toml 只有解析能力没有序列化能力，我们用简单格式
  const lines: string[] = [
    '# Abyssal 全局配置（自动生成，可手动编辑）',
    '',
    '[apiKeys]',
  ];

  for (const [key, val] of Object.entries(merged.apiKeys)) {
    if (val === null || val === undefined) {
      lines.push(`# ${key} = ""`);
    } else {
      lines.push(`${key} = ${JSON.stringify(val)}`);
    }
  }

  lines.push('', '[llm]');
  lines.push(`defaultProvider = ${JSON.stringify(merged.llm.defaultProvider)}`);
  lines.push(`defaultModel = ${JSON.stringify(merged.llm.defaultModel)}`);

  lines.push('', '[rag]');
  lines.push(`embeddingBackend = ${JSON.stringify(merged.rag.embeddingBackend)}`);
  lines.push(`embeddingModel = ${JSON.stringify(merged.rag.embeddingModel)}`);
  lines.push(`embeddingDimension = ${merged.rag.embeddingDimension}`);
  lines.push(`rerankerBackend = ${JSON.stringify(merged.rag.rerankerBackend)}`);
  lines.push(`correctiveRagEnabled = ${merged.rag.correctiveRagEnabled}`);

  lines.push('', '[acquire]');
  lines.push(`enabledSources = ${JSON.stringify(merged.acquire.enabledSources)}`);
  lines.push(`enableScihub = ${merged.acquire.enableScihub}`);
  lines.push(`perSourceTimeoutMs = ${merged.acquire.perSourceTimeoutMs}`);
  lines.push('');

  fs.writeFileSync(configPath, lines.join('\n'), 'utf-8');
}

// ═══ 环境变量覆盖 ═══

const ENV_MAP: Record<string, [keyof GlobalConfig, string]> = {
  ABYSSAL_ANTHROPIC_API_KEY: ['apiKeys', 'anthropicApiKey'],
  ABYSSAL_OPENAI_API_KEY: ['apiKeys', 'openaiApiKey'],
  ABYSSAL_DEEPSEEK_API_KEY: ['apiKeys', 'deepseekApiKey'],
  ABYSSAL_SEMANTIC_SCHOLAR_API_KEY: ['apiKeys', 'semanticScholarApiKey'],
  ABYSSAL_OPENALEX_EMAIL: ['apiKeys', 'openalexEmail'],
  ABYSSAL_UNPAYWALL_EMAIL: ['apiKeys', 'unpaywallEmail'],
  ABYSSAL_COHERE_API_KEY: ['apiKeys', 'cohereApiKey'],
  ABYSSAL_JINA_API_KEY: ['apiKeys', 'jinaApiKey'],
  ABYSSAL_LLM_PROVIDER: ['llm', 'defaultProvider'],
  ABYSSAL_LLM_MODEL: ['llm', 'defaultModel'],
};

function applyEnvOverrides(config: GlobalConfig): GlobalConfig {
  for (const [envKey, [section, field]] of Object.entries(ENV_MAP)) {
    const val = process.env[envKey];
    if (val !== undefined) {
      (config[section] as unknown as Record<string, unknown>)[field] = val;
    }
  }
  return config;
}
