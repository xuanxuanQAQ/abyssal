// ═══ 配置加载与深度合并 ═══
// §1: 四层优先级合并 + deepMerge 算法 + enforceSchema

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AbyssalConfig,
  GlobalConfig,
  ApiKeysConfig,
  ConceptChangeConfig,
  NotesConfig,
  BatchConfig,
  AdvisoryConfig,
  LoggingConfig,
  WritingConfig,
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
  PersonalizationConfig,
  WebSearchConfig,
  AppearanceConfig,
} from '../types/config';
import { ConfigError, ConfigParseError } from '../types/errors';
import { CONFIG_FIELD_DEFS, coerceToSchemaType, getNestedValue } from './config-schema';
import { parseEnvironmentVariables, resolveApiKeys } from './env-parser';
import { normalizeWorkflowOverrideKey, normalizeWorkflowOverrides } from './workflow-override-keys';

type WarnFn = (message: string, ctx?: Record<string, unknown>) => void;

/**
 * 缓冲式警告收集器。
 *
 * 配置加载发生在 Logger 创建之前（鸡生蛋问题），
 * 所以先收集警告，Logger 就绪后调用 flush() 回放。
 */
export class BufferedWarnCollector {
  private readonly buffer: Array<{ message: string; ctx: Record<string, unknown> | undefined }> = [];

  readonly warn: WarnFn = (message, ctx) => {
    this.buffer.push({ message, ctx });
  };

  /** 将缓冲的警告回放到 Logger（或其他 sink） */
  flush(sink: WarnFn): void {
    for (const { message, ctx } of this.buffer) {
      if (ctx !== undefined) {
        sink(message, ctx);
      } else {
        sink(message);
      }
    }
    this.buffer.length = 0;
  }

  get length(): number {
    return this.buffer.length;
  }
}

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
 * | --verbose     | logging.level = 'debug'| boolean  |
 * | --log-level   | logging.level          | string   |
 * | --force       | batch.force            | boolean  |
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

  // --verbose → logging.level = 'debug'
  if (cliArgs['verbose'] === true) {
    if (!result['logging']) result['logging'] = {};
    (result['logging'] as Record<string, unknown>)['level'] = 'debug';
  }

  // --log-level → logging.level（优先级高于 --verbose）
  if (cliArgs['logLevel'] !== undefined) {
    if (!result['logging']) result['logging'] = {};
    (result['logging'] as Record<string, unknown>)['level'] = cliArgs['logLevel'];
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
 * §1.2: [llm.discovery] / [llm.analysis] 等子节映射到 canonical workflowOverrides.*
 */
function flattenTomlSections(parsed: Record<string, unknown>): Record<string, unknown> {
  const result = { ...parsed };

  if (result['llm'] && typeof result['llm'] === 'object') {
    const llm = { ...(result['llm'] as Record<string, unknown>) };
    const workflowKeys = ['discover', 'discovery', 'analyze', 'analysis', 'synthesize', 'article', 'agent', 'vision', 'generate'];
    const overrides: Record<string, unknown> =
      (llm['workflowOverrides'] as Record<string, unknown>) ?? {};

    for (const key of workflowKeys) {
      if (llm[key] && typeof llm[key] === 'object') {
        overrides[normalizeWorkflowOverrideKey(key)] = llm[key];
        delete llm[key];
      }
    }

    llm['workflowOverrides'] = normalizeWorkflowOverrides(overrides);
    result['llm'] = llm;
  }

  return result;
}

/**
 * §1.2b: [acquire] 段中 TOML 的布尔简写 → 运行时字段映射。
 *
 * TOML 允许用户写：
 *   unpaywall = true
 *   arxiv = true
 *   scihub = true
 *
 * 但运行时配置期望：
 *   enabledSources: ["unpaywall", "arxiv", ...]
 *   enableScihub: true
 *
 * 此函数在 snakeToCamelDeep 之前调用（输入仍是 snake_case 键名）。
 */
function normalizeAcquireSection(parsed: Record<string, unknown>): Record<string, unknown> {
  const result = { ...parsed };
  const acquire = result['acquire'];
  if (!acquire || typeof acquire !== 'object') return result;

  const acq = { ...(acquire as Record<string, unknown>) };

  // ── 布尔简写 → enabledSources 数组 ──
  // 已知数据源标识（TOML 中可作为布尔开关使用的键名）
  const SOURCE_KEYS = ['unpaywall', 'arxiv', 'pmc', 'institutional'] as const;
  const hasAnySourceFlag = SOURCE_KEYS.some((k) => typeof acq[k] === 'boolean');

  if (hasAnySourceFlag) {
    // 用户使用了布尔简写 → 从中构建 enabledSources
    const sources: string[] = [];
    for (const key of SOURCE_KEYS) {
      if (acq[key] === true) sources.push(key);
      delete acq[key]; // 清理，防止作为杂余字段进入运行时配置
    }
    // 仅当用户未显式提供 enabled_sources 数组时才从布尔推断
    if (!acq['enabled_sources'] && !acq['enabledSources']) {
      acq['enabled_sources'] = sources;
    }
  }

  // ── scihub → enable_scihub 映射 ──
  // TOML 中 `scihub = true` 应映射到运行时的 `enableScihub`
  if (typeof acq['scihub'] === 'boolean' && acq['enable_scihub'] === undefined) {
    acq['enable_scihub'] = acq['scihub'];
    delete acq['scihub'];
  }

  // ── scihub_domain: 保持原样（snake_case → camelCase 由后续处理） ──

  result['acquire'] = acq;
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
};

export const DEFAULT_ACQUIRE: AcquireConfig = {
  enabledSources: ['unpaywall', 'arxiv', 'pmc'],
  enableScihub: false,
  scihubDomain: null,
  institutionalProxyUrl: null,
  perSourceTimeoutMs: 30_000,
  maxRedirects: 5,
  maxRetries: 1,
  retryDelayMs: 2000,
  scihubMaxTotalMs: 60_000,
  tarMaxExtractBytes: 200 * 1024 * 1024,
  enableContentSanityCheck: false,
  sanityCheckMaxChars: 2000,
  sanityCheckConfidenceThreshold: 0.85,
  enableFailureMemory: true,
  failureMemoryWindowDays: 90,
  enableFuzzyResolve: true,
  fuzzyResolveConfidenceThreshold: 0.8,
  enableChinaInstitutional: false,
  chinaInstitutionId: null,
  chinaCustomIdpEntityId: null,
  enableCnki: false,
  enableWanfang: false,
  // Pipeline v2
  enableFastPath: true,
  enableRecon: true,
  reconCacheTtlDays: 30,
  oaCacheRefreshDays: 7,
  reconTimeoutMs: 10_000,
  enablePreflight: true,
  preflightTimeoutMs: 5_000,
  enableSpeculativeExecution: true,
  maxSpeculativeParallel: 3,
  speculativeTotalTimeoutMs: 45_000,
  ezproxyUrlTemplate: null,
  proxyEnabled: false,
  proxyUrl: 'http://127.0.0.1:7890',
  proxyMode: 'blocked-only',
};

const DEFAULT_DISCOVERY: DiscoveryConfig = {
  searchBackend: 'openalex',
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

export const DEFAULT_RAG: RagConfig = {
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  embeddingProvider: 'openai',
  defaultTopK: 10,
  expandFactor: 3,
  rerankerBackend: 'cohere',
  rerankerModel: null,
  tentativeExpandFactorMultiplier: 2.0,
  tentativeTopkMultiplier: 1.5,
  correctiveRagEnabled: true,
  correctiveRagMaxRetries: 2,
  correctiveRagModel: 'deepseek-chat',
  crossConceptBoostFactor: 1.5,
};

const DEFAULT_LANGUAGE: LanguageConfig = {
  internalWorkingLanguage: 'en',
  defaultOutputLanguage: 'zh-CN',
  uiLocale: 'en',
};

export const DEFAULT_LLM: LlmConfig = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  workflowOverrides: {},
};

export const DEFAULT_API_KEYS: ApiKeysConfig = {
  anthropicApiKey: null,
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

const DEFAULT_LOGGING: LoggingConfig = {
  level: 'info',
};

const DEFAULT_WRITING: WritingConfig = {
  defaultCslStyleId: 'gb-t-7714',
  defaultOutputLanguage: 'zh',
  cslStylesDir: '',
  cslLocalesDir: '',
};

const DEFAULT_PERSONALIZATION: PersonalizationConfig = {
  authorDisplayThreshold: 1,
};

const DEFAULT_WEB_SEARCH: WebSearchConfig = {
  enabled: false,
  backend: 'tavily',
};

const DEFAULT_APPEARANCE: AppearanceConfig = {
  colorScheme: 'system',
  accentColor: '#3B82F6',
  fontSize: 'base',
  animationEnabled: true,
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
  logging: DEFAULT_LOGGING,
  writing: DEFAULT_WRITING,
  personalization: DEFAULT_PERSONALIZATION,
  ai: { proactiveSuggestions: false },
  webSearch: DEFAULT_WEB_SEARCH,
  appearance: DEFAULT_APPEARANCE,
};

// ═══ §1.6 配置加载的完整流程 ═══

export interface LoadConfigOptions {
  /** CLI 参数（已解析） */
  cliArgs?: Record<string, unknown>;
  /** 配置���件路径覆盖 */
  configPath?: string;
  /** 环境变量源（默认 process.env） */
  env?: Record<string, string | undefined>;
  /** 警告回调（默认使用 BufferedWarnCollector，通过返回值的 warnCollector 获取） */
  warn?: WarnFn;
}

export interface LoadConfigResult {
  config: AbyssalConfig;
  /** 非 null 仅当未传入自定义 warn 时——调用 flush(logger.warn) 回放到 Logger */
  warnCollector: BufferedWarnCollector | null;
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
export function loadConfig(opts: LoadConfigOptions = {}): LoadConfigResult {
  const collector = opts.warn ? null : new BufferedWarnCollector();
  const {
    cliArgs = {},
    env = process.env,
    warn = collector!.warn,
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

    // 展平 TOML 子节 + acquire 布尔简写规范化 + snake_case → camelCase
    tomlParsed = flattenTomlSections(tomlParsed);
    tomlParsed = normalizeAcquireSection(tomlParsed);
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

  return {
    config: config as unknown as AbyssalConfig,
    warnCollector: collector,
  };
}

// ═══ §1.7 统一配置加载（Electron + CLI 共用） ═══

/**
 * 五层优先级加载——供 Electron 的 loadFromWorkspace 调用。
 *
 * Layer 0: 硬编码默认值 (DEFAULT_CONFIG)
 * Layer 1: 全局配置      (%APPDATA%/global-config.toml)
 * Layer 2: 项目配置      (config/abyssal.toml)          — 版本控制
 * Layer 3: 本地覆盖      (.abyssal/config.toml)          — gitignore
 * Layer 4: 环境变量                                       — 最高优先级
 */
export interface LoadUnifiedConfigOptions {
  workspaceRoot: string;
  globalConfig: GlobalConfig;
  env?: Record<string, string | undefined>;
  warn?: WarnFn;
}

export function loadUnifiedConfig(opts: LoadUnifiedConfigOptions): Readonly<AbyssalConfig> {
  const {
    workspaceRoot,
    globalConfig,
    env = process.env,
    warn = () => {},
  } = opts;

  // Layer 0: 默认值
  let config = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;

  // Layer 1: 全局配置（apiKeys, llm, rag, acquire, webSearch）
  const globalLayer: Record<string, unknown> = {
    apiKeys: globalConfig.apiKeys,
    llm: globalConfig.llm,
    rag: globalConfig.rag,
    acquire: globalConfig.acquire,
  };
  if (globalConfig.webSearch) {
    globalLayer['webSearch'] = globalConfig.webSearch;
  }
  config = deepMerge(config, globalLayer);

  // Layer 2: 项目配置（config/abyssal.toml）
  const projectTomlPath = path.join(workspaceRoot, 'config', 'abyssal.toml');
  const projectToml = readAndParseToml(projectTomlPath, warn);
  if (projectToml) {
    config = deepMerge(config, projectToml);
  }

  // Layer 3: 本地覆盖（.abyssal/config.toml）
  const localTomlPath = path.join(workspaceRoot, '.abyssal', 'config.toml');
  const localToml = readAndParseToml(localTomlPath, warn);
  if (localToml) {
    config = deepMerge(config, localToml);
  }

  // Layer 4: 环境变量
  const envConfig = parseEnvironmentVariables(env, warn);
  config = deepMerge(config, envConfig);

  // API keys 特殊处理（环境变量优先级最高）
  const existingApiKeys = (config['apiKeys'] ?? {}) as Partial<ApiKeysConfig>;
  config['apiKeys'] = resolveApiKeys(env, existingApiKeys);

  // enforceSchema
  config = enforceSchema(config, warn);

  // 填充 workspace 和 project.name
  const projectSection = (config['project'] ?? {}) as Record<string, unknown>;
  if (!projectSection['name']) {
    projectSection['name'] = path.basename(workspaceRoot);
  }
  config['project'] = projectSection;

  const workspace: WorkspaceConfig = {
    baseDir: workspaceRoot,
    dbFileName: 'abyssal.db',
    pdfDir: 'pdfs',
    textDir: 'texts',
    reportsDir: 'reports',
    notesDir: 'notes',
    logsDir: path.join('.abyssal', 'logs'),
    snapshotsDir: path.join('.abyssal', 'snapshots'),
    privateDocsDir: 'private_docs',
  };
  config['workspace'] = workspace;

  // 填充 writing.cslStylesDir / cslLocalesDir（从 workspace 路径派生）
  const writingSection = (config['writing'] ?? {}) as Record<string, unknown>;
  if (!writingSection['cslStylesDir']) {
    writingSection['cslStylesDir'] = path.join(workspaceRoot, 'csl', 'styles');
  }
  if (!writingSection['cslLocalesDir']) {
    writingSection['cslLocalesDir'] = path.join(workspaceRoot, 'csl', 'locales');
  }
  config['writing'] = writingSection;

  const result = config as unknown as AbyssalConfig;

  // 验证
  validateConfig(result);

  return deepFreeze(result);
}

/** 读取 TOML 文件并返回 camelCase 化的 plain object，文件不存在或解析失败返回 null */
function readAndParseToml(
  filePath: string,
  warn: WarnFn,
): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;

  let content: string;
  try {
    content = stripBom(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    warn(`Cannot read config file: ${filePath}`);
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    const toml = require('smol-toml');
    parsed = toml.parse(content) as Record<string, unknown>;
  } catch {
    warn(`TOML parse error in ${filePath}, skipping`);
    return null;
  }

  parsed = flattenTomlSections(parsed);
  parsed = normalizeAcquireSection(parsed);
  parsed = snakeToCamelDeep(parsed);
  return parsed;
}

/** 独立验证函数，供 loadUnifiedConfig 和 loadConfig 共用 */
function validateConfig(config: AbyssalConfig): void {
  if (config.rag.embeddingDimension <= 0) {
    throw new ConfigError({
      message: 'rag.embeddingDimension must be > 0',
      context: { fieldPath: 'rag.embeddingDimension', actual: config.rag.embeddingDimension },
    });
  }
  if (config.rag.defaultTopK <= 0) {
    throw new ConfigError({
      message: 'rag.defaultTopK must be > 0',
      context: { fieldPath: 'rag.defaultTopK', actual: config.rag.defaultTopK },
    });
  }
  if (config.analysis.maxTokensPerChunk <= 0) {
    throw new ConfigError({
      message: 'analysis.maxTokensPerChunk must be > 0',
      context: { fieldPath: 'analysis.maxTokensPerChunk', actual: config.analysis.maxTokensPerChunk },
    });
  }
  if (config.analysis.overlapTokens < 0) {
    throw new ConfigError({
      message: 'analysis.overlapTokens must be >= 0',
      context: { fieldPath: 'analysis.overlapTokens', actual: config.analysis.overlapTokens },
    });
  }
  if (config.discovery.traversalDepth < 0) {
    throw new ConfigError({
      message: 'discovery.traversalDepth must be >= 0',
      context: { fieldPath: 'discovery.traversalDepth', actual: config.discovery.traversalDepth },
    });
  }
  const validRerankerBackends = ['cohere', 'jina', 'siliconflow'];
  if (!validRerankerBackends.includes(config.rag.rerankerBackend)) {
    throw new ConfigError({
      message: `rag.rerankerBackend must be one of: ${validRerankerBackends.join(', ')}`,
      context: { fieldPath: 'rag.rerankerBackend', actual: config.rag.rerankerBackend },
    });
  }
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
