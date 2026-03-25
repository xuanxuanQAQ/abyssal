import type {
  AbyssalConfig,
  ProjectConfig,
  AcquireConfig,
  DiscoveryConfig,
  AnalysisConfig,
  RagConfig,
  LanguageConfig,
  LlmConfig,
  ApiKeysConfig,
  WorkspaceConfig,
  ConceptsConfig,
} from '../types/config';
import { ConfigError, MissingFieldError } from '../types/errors';

// TODO: smol-toml 需确认已安装到 dependencies

// ═══ 默认值 ═══

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

// ═══ 环境变量覆盖 ═══

const ENV_PREFIX = 'ABYSSAL_';

/**
 * 将大写蛇形 → 驼峰 + 点分层级
 * e.g. ABYSSAL_RAG_EMBEDDING_DIMENSION → rag.embeddingDimension
 */
function envKeyToPath(envKey: string): string[] {
  const stripped = envKey.slice(ENV_PREFIX.length);
  const parts = stripped.toLowerCase().split('_');

  // 第一段是配置段名
  const section = parts[0]!;
  if (parts.length === 1) return [section];

  // 剩余段拼接为 camelCase 字段名
  const rest = parts.slice(1);
  const field = rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');

  return [section, field];
}

/** 尝试自动转换字符串值 */
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

// ═══ 递归冻结 ═══

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  // Fix: 遍历所有自有属性（含数组元素），递归冻结子对象
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return obj;
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
   * 从 TOML 文件加载并验证配置。
   *
   * 流程：TOML 解析 → 环境变量覆盖 → 默认值填充 → 类型校验 → 冻结
   */
  static load(tomlFilePath: string): Readonly<AbyssalConfig> {
    // 1. 读取 TOML 文件
    const fs = require('node:fs');
    const content = fs.readFileSync(tomlFilePath, 'utf-8') as string;

    // 2. TOML 解析
    let raw: Record<string, unknown>;
    try {
      const toml = require('smol-toml');
      raw = toml.parse(content) as Record<string, unknown>;
    } catch (cause) {
      throw new ConfigError({
        message: `Failed to parse TOML config: ${tomlFilePath}`,
        cause: cause instanceof Error ? cause : undefined,
        context: { filePath: tomlFilePath },
      });
    }

    // 3. 环境变量覆盖
    applyEnvOverrides(raw);

    // 4. 默认值填充 + 必填校验
    requireField(raw, 'project.name', 'string');
    requireField(raw, 'workspace.baseDir', 'string');

    const config = ConfigLoader.fillDefaults(raw);

    // 5. 类型校验
    ConfigLoader.validate(config);

    // 6. 冻结
    return deepFreeze(config);
  }

  private static fillDefaults(
    raw: Record<string, unknown>,
  ): AbyssalConfig {
    const rawProject = (raw['project'] ?? {}) as Record<string, unknown>;
    const rawAcquire = (raw['acquire'] ?? {}) as Record<string, unknown>;
    const rawDiscovery = (raw['discovery'] ?? {}) as Record<string, unknown>;
    const rawAnalysis = (raw['analysis'] ?? {}) as Record<string, unknown>;
    const rawRag = (raw['rag'] ?? {}) as Record<string, unknown>;
    const rawLanguage = (raw['language'] ?? {}) as Record<string, unknown>;
    const rawLlm = (raw['llm'] ?? {}) as Record<string, unknown>;
    const rawApiKeys = (raw['apiKeys'] ?? raw['api_keys'] ?? {}) as Record<
      string,
      unknown
    >;
    const rawWorkspace = (raw['workspace'] ?? {}) as Record<string, unknown>;
    const rawConcepts = (raw['concepts'] ?? {}) as Record<string, unknown>;

    return {
      project: {
        ...DEFAULT_PROJECT,
        ...rawProject,
      } as ProjectConfig,
      acquire: {
        ...DEFAULT_ACQUIRE,
        ...rawAcquire,
      } as AcquireConfig,
      discovery: {
        ...DEFAULT_DISCOVERY,
        ...rawDiscovery,
      } as DiscoveryConfig,
      analysis: {
        ...DEFAULT_ANALYSIS,
        ...rawAnalysis,
      } as AnalysisConfig,
      rag: {
        ...DEFAULT_RAG,
        ...rawRag,
      } as RagConfig,
      language: {
        ...DEFAULT_LANGUAGE,
        ...rawLanguage,
      } as LanguageConfig,
      llm: {
        ...DEFAULT_LLM,
        ...rawLlm,
        workflowOverrides: {
          ...DEFAULT_LLM.workflowOverrides,
          ...((rawLlm['workflowOverrides'] ?? {}) as Record<string, unknown>),
        },
      } as LlmConfig,
      apiKeys: {
        ...DEFAULT_API_KEYS,
        ...rawApiKeys,
      } as ApiKeysConfig,
      workspace: {
        ...DEFAULT_WORKSPACE_PARTIAL,
        ...rawWorkspace,
      } as WorkspaceConfig,
      concepts: {
        ...DEFAULT_CONCEPTS,
        ...rawConcepts,
      } as ConceptsConfig,
    };
  }

  private static validate(config: AbyssalConfig): void {
    // 数值范围
    if (config.rag.embeddingDimension <= 0) {
      throw new ConfigError({
        message: 'rag.embeddingDimension must be > 0',
        context: {
          fieldPath: 'rag.embeddingDimension',
          actual: config.rag.embeddingDimension,
        },
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
        context: {
          fieldPath: 'analysis.maxTokensPerChunk',
          actual: config.analysis.maxTokensPerChunk,
        },
      });
    }

    if (config.analysis.overlapTokens < 0) {
      throw new ConfigError({
        message: 'analysis.overlapTokens must be >= 0',
        context: {
          fieldPath: 'analysis.overlapTokens',
          actual: config.analysis.overlapTokens,
        },
      });
    }

    if (config.discovery.traversalDepth < 0) {
      throw new ConfigError({
        message: 'discovery.traversalDepth must be >= 0',
        context: {
          fieldPath: 'discovery.traversalDepth',
          actual: config.discovery.traversalDepth,
        },
      });
    }

    // 字面量联合成员检查
    const validEmbeddingBackends = ['api', 'local-onnx'];
    if (!validEmbeddingBackends.includes(config.rag.embeddingBackend)) {
      throw new ConfigError({
        message: `rag.embeddingBackend must be one of: ${validEmbeddingBackends.join(', ')}`,
        context: {
          fieldPath: 'rag.embeddingBackend',
          actual: config.rag.embeddingBackend,
        },
      });
    }

    const validRerankerBackends = ['api-cohere', 'api-jina', 'local-bge'];
    if (!validRerankerBackends.includes(config.rag.rerankerBackend)) {
      throw new ConfigError({
        message: `rag.rerankerBackend must be one of: ${validRerankerBackends.join(', ')}`,
        context: {
          fieldPath: 'rag.rerankerBackend',
          actual: config.rag.rerankerBackend,
        },
      });
    }

    const validModes = ['anchored', 'unanchored', 'auto'];
    if (!validModes.includes(config.project.mode)) {
      throw new ConfigError({
        message: `project.mode must be one of: ${validModes.join(', ')}`,
        context: { fieldPath: 'project.mode', actual: config.project.mode },
      });
    }
  }
}
