// ═══ 配置加载与深度合并 ═══
// §1: 四层优先级合并 + deepMerge 算法 + enforceSchema

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AbyssalConfig,
  ApiKeysConfig,
  ConceptChangeConfig,
  NotesConfig,
  BatchConfig,
  AdvisoryConfig,
  ProjectConfig,
  AcquireConfig,
  DiscoveryConfig,
  AnalysisConfig,
  RagConfig,
  LanguageConfig,
  LlmConfig,
  WorkspaceConfig,
  ConceptsConfig,
  ContextBudgetConfig,
} from '../types/config';
import { ConfigParseError } from '../types/errors';
import { CONFIG_FIELD_DEFS, coerceToSchemaType, getNestedValue } from './config-schema';
import { parseEnvironmentVariables, resolveApiKeys } from './env-parser';

// TODO — Logger 注入；当前使用 console.warn 作为占位
type WarnFn = (message: string, ctx?: Record<string, unknown>) => void;

// ═══ §1.2 深度合并算法 ═══

/**
 * 递归深度合并 base 和 override。
 *
 * 规则：
 * - override 中 undefined → 保留 base
 * - override 中 null → 显式清除（设为 null）
 * - 两者都是 plain object → 递归合并
 * - 数组 → 替换而非合并（配置中的数组通常是完整列表）
 * - 标量或类型不同 → 直接覆盖
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(override)) {
    const overrideVal = override[key];
    const baseVal = result[key];

    if (overrideVal === undefined) {
      continue; // 未指定——保留 base
    }

    if (overrideVal === null) {
      result[key] = null; // 显式 null——清除该字段
      continue;
    }

    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      // 两者都是对象——递归合并
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else if (Array.isArray(baseVal) && Array.isArray(overrideVal)) {
      // 数组——替换而非合并
      result[key] = overrideVal;
    } else {
      // 标量或类型不同——直接覆盖
      result[key] = overrideVal;
    }
  }

  return result as T;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

// ═══ §1.5 CLI 参数映射 ═══

/**
 * CLI 参数 → 配置路径映射表。
 *
 * | CLI 参数       | 配置路径                | 类型     |
 * |---------------|------------------------|----------|
 * | --stage       | batch.stage            | string   |
 * | --concurrency | batch.concurrency      | integer  |
 * | --workspace   | workspace.baseDir      | string   |
 * | --dry-run     | batch.dryRun           | boolean  |
 * | --verbose     | (log.level = 'debug')  | boolean  |
 * | --force       | batch.force            | boolean  |
 * | --mode        | project.mode           | string   |
 * | --provider    | llm.defaultProvider    | string   |
 * | --model       | llm.defaultModel       | string   |
 * | --cost        | contextBudget.costPreference | string |
 */
export function mapCliToConfig(
  cliArgs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const mapping: Array<{
    flag: string;
    path: string[];
  }> = [
    { flag: 'stage', path: ['batch', 'stage'] },
    { flag: 'concurrency', path: ['batch', 'concurrency'] },
    { flag: 'workspace', path: ['workspace', 'baseDir'] },
    { flag: 'dryRun', path: ['batch', 'dryRun'] },
    { flag: 'dry-run', path: ['batch', 'dryRun'] },
    { flag: 'force', path: ['batch', 'force'] },
    { flag: 'mode', path: ['project', 'mode'] },
    { flag: 'provider', path: ['llm', 'defaultProvider'] },
    { flag: 'model', path: ['llm', 'defaultModel'] },
    { flag: 'cost', path: ['contextBudget', 'costPreference'] },
  ];

  for (const { flag, path: configPath } of mapping) {
    const value = cliArgs[flag];
    if (value === undefined) continue;

    // 嵌套路径设值
    let current = result;
    for (let i = 0; i < configPath.length - 1; i++) {
      const segment = configPath[i]!;
      if (!current[segment] || typeof current[segment] !== 'object') {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
    current[configPath[configPath.length - 1]!] = value;
  }

  // --verbose → 特殊处理
  if (cliArgs['verbose'] === true) {
    // TODO — log.level 不在 AbyssalConfig 中；由上层消费
    (result as Record<string, unknown>)['_verbose'] = true;
  }

  return result;
}

// ═══ §2.2 enforceSchema ═══

/**
 * 对合并后的 plain object 执行字段级强制处理。
 *
 * 每个字段按顺序：
 * 1. 类型强制转换
 * 2. null/undefined → 填充默认值
 * 3. 枚举约束检查
 * 4. 数值范围 clamp（warn 而非拒绝）
 * 5. 正则约束检查
 */
export function enforceSchema(
  config: Record<string, unknown>,
  warn?: WarnFn,
): Record<string, unknown> {
  const result = structuredClone(config);

  for (const [fieldPath, fieldDef] of Object.entries(CONFIG_FIELD_DEFS)) {
    const currentValue = getNestedValue(result, fieldPath);

    // 1. 类型强制转换
    let value = coerceToSchemaType(currentValue, fieldDef);

    // 2. null/undefined → 默认值
    if (value === null || value === undefined) {
      if (fieldDef.default !== null) {
        setNestedValue(result, fieldPath, fieldDef.default);
      }
      continue;
    }

    // 3. 枚举约束（不在此处阻断，由 validator 处理）
    // 仅做类型转换后回写

    // 4. 数值范围 clamp
    if (typeof value === 'number' && fieldDef.constraints) {
      const { min, max } = fieldDef.constraints;
      let numValue = value as number;
      if (min !== undefined && numValue < min) {
        warn?.(
          `${fieldPath} = ${numValue} below minimum ${min}, clamping`,
          { fieldPath, value: numValue, min },
        );
        numValue = min;
      }
      if (max !== undefined && numValue > max) {
        warn?.(
          `${fieldPath} = ${numValue} above maximum ${max}, clamping`,
          { fieldPath, value: numValue, max },
        );
        numValue = max;
      }
      value = numValue;
    }

    // 5. 正则约束
    if (fieldDef.constraints?.pattern && typeof value === 'string') {
      if (!fieldDef.constraints.pattern.test(value)) {
        // 不 clamp——由 validator 阻断
      }
    }

    setNestedValue(result, fieldPath, value);
  }

  return result;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

// ═══ §1.3 TOML 解析 ═══

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/**
 * §1.2: [llm.analysis] 等子节映射到 llm.workflowOverrides.analysis
 */
function flattenTomlSections(parsed: Record<string, unknown>): Record<string, unknown> {
  const result = { ...parsed };

  if (result['llm'] && typeof result['llm'] === 'object') {
    const llm = { ...(result['llm'] as Record<string, unknown>) };
    const workflowKeys = ['discovery', 'analysis', 'synthesize', 'article', 'agent'];
    const overrides: Record<string, unknown> =
      (llm['workflowOverrides'] as Record<string, unknown>) ?? {};

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

/**
 * TOML 中的 snake_case 键名 → camelCase 转换。
 * 递归处理嵌套对象。
 */
function snakeToCamelDeep(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

    if (isPlainObject(value)) {
      result[camelKey] = snakeToCamelDeep(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }

  return result;
}

// ═══ 默认值常量 ═══

const DEFAULT_PROJECT: Omit<ProjectConfig, 'name'> = {
  description: '',
  mode: 'auto',
};

const DEFAULT_ACQUIRE: AcquireConfig = {
  enabledSources: ['unpaywall', 'arxiv', 'pmc'],
  enableScihub: false,
  scihubDomain: null,
  institutionalProxyUrl: null,
  perSourceTimeoutMs: 30_000,
  maxRedirects: 5,
};

const DEFAULT_DISCOVERY: DiscoveryConfig = {
  traversalDepth: 2,
  concurrency: 5,
  maxResultsPerQuery: 100,
};

const DEFAULT_ANALYSIS: AnalysisConfig = {
  templateDir: 'templates/',
  maxTokensPerChunk: 1024,
  overlapTokens: 128,
  ocrEnabled: true,
  ocrLanguages: ['eng', 'chi_sim'],
  charDensityThreshold: 10,
  vlmEnabled: false,
  autoSuggestConcepts: true,
};

const DEFAULT_RAG: RagConfig = {
  embeddingBackend: 'api',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  defaultTopK: 10,
  expandFactor: 3,
  rerankerBackend: 'local-bge',
  rerankerModel: null,
  tentativeExpandFactorMultiplier: 2.0,
  tentativeTopkMultiplier: 1.5,
  correctiveRagEnabled: true,
  correctiveRagMaxRetries: 2,
  correctiveRagModel: 'deepseek-chat',
  localOnnxModelPath: null,
  localRerankerModelPath: null,
};

const DEFAULT_LANGUAGE: LanguageConfig = {
  internalWorkingLanguage: 'en',
  defaultOutputLanguage: 'zh-CN',
};

const DEFAULT_LLM: LlmConfig = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  workflowOverrides: {},
};

const DEFAULT_API_KEYS: ApiKeysConfig = {
  anthropicApiKey: null,
  openaiApiKey: null,
  deepseekApiKey: null,
  semanticScholarApiKey: null,
  openalexEmail: null,
  unpaywallEmail: null,
  cohereApiKey: null,
  jinaApiKey: null,
};

const DEFAULT_WORKSPACE_PARTIAL: Omit<WorkspaceConfig, 'baseDir'> = {
  dbFileName: 'abyssal.db',
  pdfDir: 'pdfs/',
  textDir: 'texts/',
  reportsDir: 'reports/',
  notesDir: 'notes/',
  logsDir: 'logs/',
  snapshotsDir: 'snapshots/',
  privateDocsDir: 'private_docs/',
};

const DEFAULT_CONCEPTS: ConceptsConfig = {
  additiveChangeLookbackDays: 30,
  autoSuggestThreshold: 3,
};

const DEFAULT_CONTEXT_BUDGET: ContextBudgetConfig = {
  focusedMaxTokens: 50_000,
  broadMaxTokens: 100_000,
  outputReserveRatio: 0.15,
  safetyMarginRatio: 0.05,
  skipRerankerThreshold: 0.8,
  costPreference: 'balanced',
};

const DEFAULT_CONCEPT_CHANGE: ConceptChangeConfig = {
  jaccardThreshold: 0.5,
  additiveReviewWindowDays: 30,
  autoDetectBreaking: true,
};

const DEFAULT_NOTES: NotesConfig = {
  memoMaxLength: 500,
  memoAutoIndex: true,
  noteAutoIndex: true,
  notesDirectory: 'notes',
};

const DEFAULT_BATCH: BatchConfig = {
  concurrency: 5,
};

const DEFAULT_ADVISORY: AdvisoryConfig = {
  minPapersThreshold: 5,
};

/**
 * Layer 0 硬编码默认值——完整的 AbyssalConfig（除 project.name 和 workspace.baseDir 外）。
 */
export const DEFAULT_CONFIG: Omit<AbyssalConfig, 'project' | 'workspace'> & {
  project: Omit<ProjectConfig, 'name'> & { name: string };
  workspace: Omit<WorkspaceConfig, 'baseDir'> & { baseDir: string };
} = {
  project: { ...DEFAULT_PROJECT, name: '' },
  acquire: DEFAULT_ACQUIRE,
  discovery: DEFAULT_DISCOVERY,
  analysis: DEFAULT_ANALYSIS,
  rag: DEFAULT_RAG,
  language: DEFAULT_LANGUAGE,
  llm: DEFAULT_LLM,
  apiKeys: DEFAULT_API_KEYS,
  workspace: { ...DEFAULT_WORKSPACE_PARTIAL, baseDir: '' },
  concepts: DEFAULT_CONCEPTS,
  contextBudget: DEFAULT_CONTEXT_BUDGET,
  conceptChange: DEFAULT_CONCEPT_CHANGE,
  notes: DEFAULT_NOTES,
  batch: DEFAULT_BATCH,
  advisory: DEFAULT_ADVISORY,
};

// ═══ §1.6 配置加载的完整流程 ═══

export interface LoadConfigOptions {
  /** CLI 参数（已解析） */
  cliArgs?: Record<string, unknown>;
  /** 配置文件路径覆盖 */
  configPath?: string;
  /** 环境变量源（默认 process.env） */
  env?: Record<string, string | undefined>;
  /** 警告回调 */
  warn?: WarnFn;
}

/**
 * §1.6: 四层优先级加载。
 *
 * Layer 0: 硬编码默认值
 * Layer 1: config/abyssal.toml（项目配置文件）
 * Layer 2: CLI 参数
 * Layer 3: 环境变量
 * + API keys 特殊处理（优先级最高）
 */
export function loadConfig(opts: LoadConfigOptions = {}): AbyssalConfig {
  const {
    cliArgs = {},
    env = process.env,
    warn = console.warn,
  } = opts;

  // Layer 0: 默认值
  let config = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;

  // Layer 1: TOML 文件
  const tomlPath = (opts.configPath ?? cliArgs['config'] ?? 'config/abyssal.toml') as string;
  const resolvedTomlPath = path.resolve(tomlPath);

  if (fs.existsSync(resolvedTomlPath)) {
    let tomlContent: string;
    try {
      tomlContent = stripBom(fs.readFileSync(resolvedTomlPath, 'utf-8'));
    } catch (cause) {
      throw new ConfigParseError({
        message: `Cannot read config file: ${resolvedTomlPath}`,
        cause: cause instanceof Error ? cause : undefined,
        context: { file: resolvedTomlPath },
      });
    }

    let tomlParsed: Record<string, unknown>;
    try {
      const toml = require('smol-toml');
      tomlParsed = toml.parse(tomlContent) as Record<string, unknown>;
    } catch (cause) {
      const err = cause as Error & { line?: number; column?: number };
      throw new ConfigParseError({
        message: `TOML syntax error in ${resolvedTomlPath}: ${err.message}`,
        cause: cause instanceof Error ? cause : undefined,
        context: { file: resolvedTomlPath, line: err.line, column: err.column },
      });
    }

    // 展平 TOML 子节 + snake_case → camelCase
    tomlParsed = flattenTomlSections(tomlParsed);
    tomlParsed = snakeToCamelDeep(tomlParsed);

    config = deepMerge(config, tomlParsed);
  } else {
    warn(`Config file not found, using defaults: ${resolvedTomlPath}`);
  }

  // Layer 2: CLI 参数
  if (Object.keys(cliArgs).length > 0) {
    const cliConfig = mapCliToConfig(cliArgs);
    config = deepMerge(config, cliConfig);
  }

  // Layer 3: 环境变量
  const envConfig = parseEnvironmentVariables(env, warn);
  config = deepMerge(config, envConfig);

  // API keys 特殊处理（优先级最高——安全敏感信息必须从环境变量获取）
  const existingApiKeys = (config['apiKeys'] ?? {}) as Partial<ApiKeysConfig>;
  config['apiKeys'] = resolveApiKeys(env, existingApiKeys);

  // enforceSchema——字段级类型转换 + clamp
  config = enforceSchema(config, warn);

  return config as unknown as AbyssalConfig;
}

// ═══ 递归冻结 ═══

export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return obj;
}
