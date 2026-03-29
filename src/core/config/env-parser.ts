// ═══ 环境变量解析 ═══
// §1.4: ABYSSAL_ 前缀映射 + 类型强制转换 + API key 特殊映射

import type { ApiKeysConfig } from '../types/config';
import type { FieldDefinition } from './config-schema';
import { CONFIG_FIELD_DEFS, coerceToSchemaType, getNestedValue } from './config-schema';

// TODO — Logger 注入由调用方决定；此处使用可选 warn 回调
export type WarnFn = (message: string, ctx?: Record<string, unknown>) => void;

// ─── 常量 ───

const ABYSSAL_PREFIX = 'ABYSSAL_';

/**
 * 非 ABYSSAL_ 前缀的特殊 API key 环境变量映射。
 * 安全敏感信息优先从环境变量获取（优先级最高）。
 */
const API_KEY_ENV_MAP: Record<string, keyof ApiKeysConfig> = {
  ANTHROPIC_API_KEY: 'anthropicApiKey',
  OPENAI_API_KEY: 'openaiApiKey',
  DEEPSEEK_API_KEY: 'deepseekApiKey',
};

// ─── 环境变量名 → 配置路径 ───

/**
 * 将 ABYSSAL_RAG_EMBEDDING_DIM → ['rag', 'embeddingDim']
 *
 * 规则：
 * - 去掉 ABYSSAL_ 前缀
 * - 第一段下划线分隔 → 配置段名（小写）
 * - 剩余段拼接为 camelCase 字段名
 */
function envKeyToPath(envKey: string): string[] {
  const stripped = envKey.slice(ABYSSAL_PREFIX.length);
  const parts = stripped.toLowerCase().split('_');

  const section = parts[0]!;
  if (parts.length === 1) return [section];

  const rest = parts.slice(1);
  const field = rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');

  return [section, field];
}

// ─── 类型强制转换 ───

/**
 * §1.4 类型强制转换规则：
 *
 * | 环境变量值         | schema 目标类型 | 转换                |
 * |-------------------|----------------|---------------------|
 * | "true" / "false"  | boolean        | Boolean 解析         |
 * | 纯数字字符串       | integer        | parseInt            |
 * | 含小数点数字       | float          | parseFloat          |
 * | "null"            | any            | null                |
 * | 其他              | string         | 原样保留             |
 *
 * 如果找到对应的 CONFIG_FIELD_DEFS 条目，使用 coerceToSchemaType 精确转换。
 * 否则使用通用推断。
 */
function coerceEnvValue(raw: string, fieldDef?: FieldDefinition): unknown {
  if (raw === 'null') return null;

  // 如果有 schema 定义，使用精确转换
  if (fieldDef) {
    return coerceToSchemaType(raw, fieldDef);
  }

  // 通用推断
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.includes(',')) return raw.split(',').map((s) => s.trim());
  return raw;
}

// ─── 查找 fieldPath 对应的 FieldDefinition ───

function findFieldDef(section: string, field: string): FieldDefinition | undefined {
  // 先尝试直接查找 section.field
  const directPath = `${section}.${field}`;
  if (CONFIG_FIELD_DEFS[directPath]) return CONFIG_FIELD_DEFS[directPath];

  // 尝试通过 envVar 反查
  const envVarName = `${ABYSSAL_PREFIX}${section.toUpperCase()}_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
  for (const [, def] of Object.entries(CONFIG_FIELD_DEFS)) {
    if (def.envVar === envVarName) return def;
  }

  return undefined;
}

// ─── 主入口 ───

/**
 * §1.4: 从 process.env 解析全部 ABYSSAL_ 前缀的环境变量。
 *
 * 返回一个与 AbyssalConfig 结构对齐的 plain object（仅包含被环境变量覆盖的字段）。
 */
export function parseEnvironmentVariables(
  env: Record<string, string | undefined> = process.env,
  warn?: WarnFn,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(env)) {
    if (!key.startsWith(ABYSSAL_PREFIX) || rawValue === undefined) continue;

    const pathParts = envKeyToPath(key);
    if (pathParts.length < 2) continue;

    const section = pathParts[0]!;
    const field = pathParts[1]!;

    // 查找 schema 定义以精确转换
    const fieldDef = findFieldDef(section, field);

    let value: unknown;
    try {
      value = coerceEnvValue(rawValue, fieldDef);
    } catch {
      // §1.4: 转换失败——记录 warn 日志，跳过该变量
      warn?.(
        `环境变量 ${key} 的值 '${rawValue}' 无法转换为 ${fieldDef?.type ?? 'unknown'}，已跳过`,
        { envKey: key, rawValue, expectedType: fieldDef?.type },
      );
      continue;
    }

    // 设置到嵌套结构
    let sectionObj = result[section] as Record<string, unknown> | undefined;
    if (!sectionObj || typeof sectionObj !== 'object') {
      sectionObj = {};
      result[section] = sectionObj;
    }
    sectionObj[field] = value;
  }

  return result;
}

/**
 * §1.6: API keys 的特殊处理——优先级最高。
 *
 * 从环境变量和已有配置中合并 API keys。
 * 直接从 ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY 读取（不用 ABYSSAL_ 前缀）。
 */
export function resolveApiKeys(
  env: Record<string, string | undefined>,
  existingKeys: Partial<ApiKeysConfig>,
): ApiKeysConfig {
  const resolved: ApiKeysConfig = {
    anthropicApiKey: existingKeys.anthropicApiKey ?? null,
    openaiApiKey: existingKeys.openaiApiKey ?? null,
    deepseekApiKey: existingKeys.deepseekApiKey ?? null,
    semanticScholarApiKey: existingKeys.semanticScholarApiKey ?? null,
    openalexEmail: existingKeys.openalexEmail ?? null,
    unpaywallEmail: existingKeys.unpaywallEmail ?? null,
    cohereApiKey: existingKeys.cohereApiKey ?? null,
    jinaApiKey: existingKeys.jinaApiKey ?? null,
  };

  // 非 ABYSSAL_ 前缀的特殊映射（优先级最高）
  for (const [envVar, configKey] of Object.entries(API_KEY_ENV_MAP)) {
    const val = env[envVar];
    if (val !== undefined && val !== '') {
      (resolved as unknown as Record<string, unknown>)[configKey] = val;
    }
  }

  // ABYSSAL_ 前缀的 API key 覆盖
  const abyssalMappings: Record<string, keyof ApiKeysConfig> = {
    ABYSSAL_SEMANTIC_SCHOLAR_API_KEY: 'semanticScholarApiKey',
    ABYSSAL_UNPAYWALL_EMAIL: 'unpaywallEmail',
    ABYSSAL_COHERE_API_KEY: 'cohereApiKey',
    ABYSSAL_JINA_API_KEY: 'jinaApiKey',
    ABYSSAL_OPENALEX_EMAIL: 'openalexEmail',
  };

  for (const [envVar, configKey] of Object.entries(abyssalMappings)) {
    const val = env[envVar];
    if (val !== undefined && val !== '') {
      (resolved as unknown as Record<string, unknown>)[configKey] = val;
    }
  }

  return resolved;
}
