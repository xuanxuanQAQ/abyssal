import type {
  AbyssalConfig,
  GlobalConfig,
} from '../types/config';
import { ConfigParseError, MissingFieldError } from '../types/errors';
import { loadUnifiedConfig, deepMerge as configDeepMerge, DEFAULT_CONFIG, deepFreeze as configDeepFreeze } from '../config/config-loader';

// Re-export canonical defaults from config-loader for backward compatibility
export {
  DEFAULT_ACQUIRE,
  DEFAULT_RAG,
  DEFAULT_LLM,
  DEFAULT_API_KEYS,
} from '../config/config-loader';

// ═══ BOM 清除 ═══

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

// ═══ TOML 节展平 ═══

/**
 * §1.2: [llm.analysis] 等子节映射到 llm.workflowOverrides.analysis
 *
 * smol-toml 将 [llm.analysis] 解析为 { llm: { analysis: { ... } } }。
 * 需要将 workflow 子键提升到 workflowOverrides 中。
 */
function flattenTomlSections(parsed: Record<string, unknown>): Record<string, unknown> {
  const result = { ...parsed };

  if (result['llm'] && typeof result['llm'] === 'object') {
    const llm = { ...(result['llm'] as Record<string, unknown>) };
    const workflowKeys = ['discovery', 'analysis', 'synthesize', 'article', 'agent'];
    const overrides: Record<string, unknown> = (llm['workflowOverrides'] as Record<string, unknown>) ?? {};

    for (const key of workflowKeys) {
      if (llm[key] && typeof llm[key] === 'object') {
        overrides[key] = llm[key];
        delete llm[key];
      }
    }

    llm['workflowOverrides'] = overrides;
    result['llm'] = llm;
  }

  return result;
}

// ═══ 环境变量覆盖 ═══

const ENV_PREFIX = 'ABYSSAL_';

function envKeyToPath(envKey: string): string[] {
  const stripped = envKey.slice(ENV_PREFIX.length);
  const parts = stripped.toLowerCase().split('_');
  const section = parts[0]!;
  if (parts.length === 1) return [section];
  const rest = parts.slice(1);
  const field = rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
  return [section, field];
}

function coerceValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\d+\.\d+$/.test(value)) return Number(value);
  if (value.includes(',')) return value.split(',').map((s) => s.trim());
  return value;
}

function applyEnvOverrides(config: Record<string, unknown>): void {
  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!key.startsWith(ENV_PREFIX) || rawValue === undefined) continue;
    const pathParts = envKeyToPath(key);
    if (pathParts.length < 2) continue;
    const section = pathParts[0]!;
    const field = pathParts[1]!;
    let sectionObj = config[section] as Record<string, unknown> | undefined;
    if (!sectionObj || typeof sectionObj !== 'object') {
      sectionObj = {};
      config[section] = sectionObj;
    }
    sectionObj[field] = coerceValue(rawValue);
  }
}

// ═══ 校验 ═══

function requireField(
  obj: Record<string, unknown>,
  fieldPath: string,
  expectedType: string,
): void {
  const parts = fieldPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      throw new MissingFieldError({
        message: `Missing required config field: ${fieldPath}`,
        context: { fieldPath, expectedType },
      });
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) {
    throw new MissingFieldError({
      message: `Missing required config field: ${fieldPath}`,
      context: { fieldPath, expectedType },
    });
  }
}

// ═══ ConfigLoader ═══

export class ConfigLoader {
  /**
   * 从单个 TOML 文件加载并验证配置（CLI 模式）。
   *
   * 流程：TOML 解析 → 环境变量覆盖 → 默认值填充 → 类型校验 → 冻结
   */
  static load(tomlFilePath: string): Readonly<AbyssalConfig> {
    const fs = require('node:fs');
    let content = fs.readFileSync(tomlFilePath, 'utf-8') as string;
    content = stripBom(content);

    let raw: Record<string, unknown>;
    try {
      const toml = require('smol-toml');
      raw = toml.parse(content) as Record<string, unknown>;
    } catch (cause) {
      const err = cause as Error & { line?: number; column?: number };
      throw new ConfigParseError({
        message: `TOML syntax error in ${tomlFilePath}: ${err.message}`,
        cause: cause instanceof Error ? cause : undefined,
        context: {
          file: tomlFilePath,
          line: err.line,
          column: err.column,
        },
      });
    }

    raw = flattenTomlSections(raw);
    applyEnvOverrides(raw);

    requireField(raw, 'project.name', 'string');
    requireField(raw, 'workspace.baseDir', 'string');

    let config = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
    config = configDeepMerge(config, raw);

    const result = config as unknown as AbyssalConfig;
    return configDeepFreeze(result);
  }

  // ═══ 工作区模式：统一五层合并 ═══

  /**
   * 从工作区目录加载配置，与全局配置合并生成运行时 AbyssalConfig。
   *
   * 五层合并策略：
   * Layer 0: 硬编码默认值
   * Layer 1: 全局配置 (%APPDATA%/global-config.toml)
   * Layer 2: 项目配置 (config/abyssal.toml)
   * Layer 3: 本地覆盖 (.abyssal/config.toml)
   * Layer 4: 环境变量
   */
  static loadFromWorkspace(
    workspaceRootDir: string,
    globalConfig: GlobalConfig,
  ): Readonly<AbyssalConfig> {
    return loadUnifiedConfig({
      workspaceRoot: workspaceRootDir,
      globalConfig,
    });
  }
}
