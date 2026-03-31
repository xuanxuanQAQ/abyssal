// ═══ 配置 Schema 定义 ═══
// 声明式字段定义：类型、默认值、约束、环境变量名、CLI 标志、敏感标记

// ─── FieldDefinition ───

export type FieldType = 'string' | 'integer' | 'float' | 'boolean' | 'enum' | 'string[]';

export interface FieldConstraints {
  min?: number;
  max?: number;
  enum?: readonly string[];
  pattern?: RegExp;
  maxLength?: number;
}

export interface FieldDefinition {
  type: FieldType;
  default: unknown;
  required: boolean;
  /** 条件必填——返回 true 时此字段必填 */
  requiredWhen?: (config: Record<string, unknown>) => boolean;
  constraints?: FieldConstraints;
  envVar?: string;
  cliFlag?: string;
  sensitive?: boolean;
  migration?: string;
}

// ─── Schema 定义 ───

export const CONFIG_FIELD_DEFS: Record<string, FieldDefinition> = {
  // ── project ──
  'project.name': {
    type: 'string',
    default: '',
    required: true,
    cliFlag: '--project-name',
  },
  'project.description': {
    type: 'string',
    default: '',
    required: false,
  },
  'project.mode': {
    type: 'enum',
    default: 'auto',
    required: false,
    constraints: { enum: ['anchored', 'unanchored', 'auto'] },
    cliFlag: '--mode',
    envVar: 'ABYSSAL_PROJECT_MODE',
  },

  // ── discovery ──
  'discovery.traversalDepth': {
    type: 'integer',
    default: 2,
    required: false,
    constraints: { min: 1, max: 4 },
  },
  'discovery.maxResultsPerQuery': {
    type: 'integer',
    default: 100,
    required: false,
    constraints: { min: 10, max: 500 },
  },
  'discovery.concurrency': {
    type: 'integer',
    default: 5,
    required: false,
    constraints: { min: 1, max: 20 },
  },

  // ── acquire ──
  'acquire.perSourceTimeoutMs': {
    type: 'integer',
    default: 30_000,
    required: false,
    constraints: { min: 10_000, max: 120_000 },
  },
  'acquire.maxRedirects': {
    type: 'integer',
    default: 5,
    required: false,
    constraints: { min: 1, max: 10 },
  },
  'acquire.enableScihub': {
    type: 'boolean',
    default: false,
    required: false,
  },
  'acquire.institutionalProxyUrl': {
    type: 'string',
    default: null,
    required: false,
    requiredWhen: (c) => {
      const sources = getNestedValue(c, 'acquire.enabledSources') as string[] | undefined;
      return Array.isArray(sources) && sources.includes('institutional');
    },
  },
  'acquire.maxRetries': {
    type: 'integer',
    default: 1,
    required: false,
    constraints: { min: 0, max: 3 },
  },
  'acquire.retryDelayMs': {
    type: 'integer',
    default: 2000,
    required: false,
    constraints: { min: 500, max: 10_000 },
  },
  'acquire.scihubMaxTotalMs': {
    type: 'integer',
    default: 60_000,
    required: false,
    constraints: { min: 15_000, max: 180_000 },
  },
  'acquire.tarMaxExtractBytes': {
    type: 'integer',
    default: 200 * 1024 * 1024,
    required: false,
    constraints: { min: 10 * 1024 * 1024, max: 500 * 1024 * 1024 },
  },
  'acquire.enableContentSanityCheck': {
    type: 'boolean',
    default: false,
    required: false,
  },
  'acquire.sanityCheckMaxChars': {
    type: 'integer',
    default: 2000,
    required: false,
    constraints: { min: 500, max: 5000 },
  },
  'acquire.sanityCheckConfidenceThreshold': {
    type: 'float',
    default: 0.85,
    required: false,
    constraints: { min: 0.5, max: 1.0 },
  },
  'acquire.enableFailureMemory': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'acquire.failureMemoryWindowDays': {
    type: 'integer',
    default: 90,
    required: false,
    constraints: { min: 7, max: 365 },
  },
  'acquire.enableFuzzyResolve': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'acquire.fuzzyResolveConfidenceThreshold': {
    type: 'float',
    default: 0.8,
    required: false,
    constraints: { min: 0.5, max: 1.0 },
  },
  'acquire.enableChinaInstitutional': {
    type: 'boolean',
    default: false,
    required: false,
  },
  'acquire.chinaInstitutionId': {
    type: 'string',
    default: null,
    required: false,
  },
  'acquire.chinaCustomIdpEntityId': {
    type: 'string',
    default: null,
    required: false,
  },
  'acquire.enableCnki': {
    type: 'boolean',
    default: false,
    required: false,
  },
  'acquire.enableWanfang': {
    type: 'boolean',
    default: false,
    required: false,
  },
  // ── Pipeline v2: 4-Layer Intelligent Acquire ──
  'acquire.enableFastPath': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'acquire.enableRecon': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'acquire.reconCacheTtlDays': {
    type: 'integer',
    default: 30,
    required: false,
    constraints: { min: 1, max: 365 },
  },
  'acquire.oaCacheRefreshDays': {
    type: 'integer',
    default: 7,
    required: false,
    constraints: { min: 1, max: 90 },
  },
  'acquire.reconTimeoutMs': {
    type: 'integer',
    default: 10_000,
    required: false,
    constraints: { min: 3_000, max: 30_000 },
  },
  'acquire.enablePreflight': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'acquire.preflightTimeoutMs': {
    type: 'integer',
    default: 5_000,
    required: false,
    constraints: { min: 2_000, max: 15_000 },
  },
  'acquire.enableSpeculativeExecution': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'acquire.maxSpeculativeParallel': {
    type: 'integer',
    default: 3,
    required: false,
    constraints: { min: 1, max: 6 },
  },
  'acquire.speculativeTotalTimeoutMs': {
    type: 'integer',
    default: 45_000,
    required: false,
    constraints: { min: 15_000, max: 120_000 },
  },
  'acquire.ezproxyUrlTemplate': {
    type: 'string',
    default: null,
    required: false,
  },
  'acquire.proxyEnabled': {
    type: 'boolean',
    default: false,
    required: false,
  },
  'acquire.proxyUrl': {
    type: 'string',
    default: 'http://127.0.0.1:7890',
    required: false,
    sensitive: true, // 可能包含认证信息
  },
  'acquire.proxyMode': {
    type: 'enum',
    default: 'blocked-only',
    required: false,
    constraints: { enum: ['all', 'blocked-only'] },
  },

  // ── rag ──
  'rag.embeddingModel': {
    type: 'string',
    default: 'text-embedding-3-small',
    required: false,
    migration: 'Changing embedding model requires full re-embedding of all chunks',
  },
  'rag.embeddingDimension': {
    type: 'integer',
    default: 1536,
    required: true,
    constraints: { min: 1 },
    envVar: 'ABYSSAL_RAG_EMBEDDING_DIM',
    migration: 'Changing embedding dimension requires full re-embedding of all chunks',
  },
  'rag.defaultTopK': {
    type: 'integer',
    default: 10,
    required: false,
    constraints: { min: 1, max: 100 },
  },
  'rag.expandFactor': {
    type: 'integer',
    default: 3,
    required: false,
    constraints: { min: 1, max: 20 },
  },
  'rag.rerankerBackend': {
    type: 'enum',
    default: 'cohere',
    required: false,
    constraints: { enum: ['cohere', 'jina', 'siliconflow'] },
  },
  'rag.embeddingProvider': {
    type: 'enum',
    default: 'openai',
    required: false,
    constraints: { enum: ['openai', 'siliconflow'] },
  },
  'rag.correctiveRagEnabled': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'rag.correctiveRagMaxRetries': {
    type: 'integer',
    default: 2,
    required: false,
    constraints: { min: 0, max: 5 },
  },
  'rag.crossConceptBoostFactor': {
    type: 'float',
    default: 1.5,
    required: false,
    constraints: { min: 1.0, max: 3.0 },
  },
  'rag.tentativeExpandFactorMultiplier': {
    type: 'float',
    default: 2.0,
    required: false,
    constraints: { min: 1.0, max: 5.0 },
  },
  'rag.tentativeTopkMultiplier': {
    type: 'float',
    default: 1.5,
    required: false,
    constraints: { min: 1.0, max: 5.0 },
  },

  // ── analysis ──
  'analysis.maxTokensPerChunk': {
    type: 'integer',
    default: 1024,
    required: false,
    constraints: { min: 128, max: 2048 },
    migration: 'Changing chunk size requires re-chunking + re-embedding',
  },
  'analysis.overlapTokens': {
    type: 'integer',
    default: 128,
    required: false,
    constraints: { min: 0 },
  },
  'analysis.ocrEnabled': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'analysis.autoSuggestConcepts': {
    type: 'boolean',
    default: true,
    required: false,
  },

  // ── context_budget ──
  'contextBudget.focusedMaxTokens': {
    type: 'integer',
    default: 50_000,
    required: false,
    constraints: { min: 10_000, max: 100_000 },
  },
  'contextBudget.broadMaxTokens': {
    type: 'integer',
    default: 100_000,
    required: false,
    constraints: { min: 30_000, max: 200_000 },
  },
  'contextBudget.outputReserveRatio': {
    type: 'float',
    default: 0.15,
    required: false,
    constraints: { min: 0.05, max: 0.30 },
  },
  'contextBudget.safetyMarginRatio': {
    type: 'float',
    default: 0.05,
    required: false,
    constraints: { min: 0.0, max: 0.20 },
  },
  'contextBudget.skipRerankerThreshold': {
    type: 'float',
    default: 0.8,
    required: false,
    constraints: { min: 0.0, max: 1.0 },
  },
  'contextBudget.costPreference': {
    type: 'enum',
    default: 'balanced',
    required: false,
    constraints: { enum: ['aggressive', 'balanced', 'conservative'] },
    cliFlag: '--cost',
    envVar: 'ABYSSAL_CONTEXT_BUDGET_COST_PREFERENCE',
  },

  // ── concept_change ──
  'conceptChange.jaccardThreshold': {
    type: 'float',
    default: 0.5,
    required: false,
    constraints: { min: 0.0, max: 1.0 },
  },
  'conceptChange.additiveReviewWindowDays': {
    type: 'integer',
    default: 30,
    required: false,
    constraints: { min: 7, max: 180 },
  },
  'conceptChange.autoDetectBreaking': {
    type: 'boolean',
    default: true,
    required: false,
  },

  // ── batch ──
  'batch.concurrency': {
    type: 'integer',
    default: 5,
    required: false,
    constraints: { min: 1, max: 10 },
    cliFlag: '--concurrency',
    envVar: 'ABYSSAL_BATCH_CONCURRENCY',
  },

  // ── advisory ──
  'advisory.minPapersThreshold': {
    type: 'integer',
    default: 5,
    required: false,
    constraints: { min: 1, max: 20 },
  },

  // ── language ──
  'language.internalWorkingLanguage': {
    type: 'enum',
    default: 'en',
    required: false,
    constraints: { enum: ['en'] },
  },
  'language.defaultOutputLanguage': {
    type: 'enum',
    default: 'zh-CN',
    required: false,
    constraints: { enum: ['en', 'zh-CN'] },
  },
  'language.uiLocale': {
    type: 'enum',
    default: 'en',
    required: false,
    constraints: { enum: ['en', 'zh-CN'] },
  },

  // ── llm ──
  'llm.defaultProvider': {
    type: 'enum',
    default: 'anthropic',
    required: false,
    constraints: { enum: ['claude', 'anthropic', 'openai', 'deepseek', 'ollama', 'siliconflow'] },
    cliFlag: '--provider',
    envVar: 'ABYSSAL_LLM_DEFAULT_PROVIDER',
  },
  'llm.defaultModel': {
    type: 'string',
    default: 'claude-sonnet-4-20250514',
    required: false,
    cliFlag: '--model',
    envVar: 'ABYSSAL_LLM_DEFAULT_MODEL',
  },

  // ── workspace ──
  'workspace.baseDir': {
    type: 'string',
    default: '',
    required: true,
    cliFlag: '--workspace',
    envVar: 'ABYSSAL_WORKSPACE_BASE_DIR',
  },

  // ── api_keys ──
  'apiKeys.anthropicApiKey': {
    type: 'string',
    default: null,
    required: false,
    sensitive: true,
    envVar: 'ANTHROPIC_API_KEY',
    requiredWhen: (c) => usesProvider(c, 'claude') || usesProvider(c, 'anthropic'),
  },
  'apiKeys.openaiApiKey': {
    type: 'string',
    default: null,
    required: false,
    sensitive: true,
    envVar: 'OPENAI_API_KEY',
    requiredWhen: (c) => usesProvider(c, 'openai'),
  },
  'apiKeys.deepseekApiKey': {
    type: 'string',
    default: null,
    required: false,
    sensitive: true,
    envVar: 'DEEPSEEK_API_KEY',
    requiredWhen: (c) => usesProvider(c, 'deepseek'),
  },
  'apiKeys.unpaywallEmail': {
    type: 'string',
    default: null,
    required: false,
    envVar: 'ABYSSAL_UNPAYWALL_EMAIL',
  },
  'apiKeys.cohereApiKey': {
    type: 'string',
    default: null,
    required: false,
    sensitive: true,
    envVar: 'ABYSSAL_COHERE_API_KEY',
    requiredWhen: (c) => getNestedValue(c, 'rag.rerankerBackend') === 'cohere',
  },
  'apiKeys.jinaApiKey': {
    type: 'string',
    default: null,
    required: false,
    sensitive: true,
    envVar: 'ABYSSAL_JINA_API_KEY',
    requiredWhen: (c) => getNestedValue(c, 'rag.rerankerBackend') === 'jina',
  },
  'apiKeys.siliconflowApiKey': {
    type: 'string',
    default: null,
    required: false,
    sensitive: true,
    envVar: 'ABYSSAL_SILICONFLOW_API_KEY',
    requiredWhen: (c) =>
      usesProvider(c, 'siliconflow') ||
      getNestedValue(c, 'rag.rerankerBackend') === 'siliconflow' ||
      getNestedValue(c, 'rag.embeddingProvider') === 'siliconflow',
  },

  'apiKeys.webSearchApiKey': {
    type: 'string',
    default: null,
    required: false,
    sensitive: true,
    envVar: 'ABYSSAL_WEB_SEARCH_API_KEY',
    requiredWhen: (c) => getNestedValue(c, 'webSearch.enabled') === true,
  },

  // ── concepts ──
  'concepts.additiveChangeLookbackDays': {
    type: 'integer',
    default: 30,
    required: false,
    constraints: { min: 1, max: 365 },
  },
  'concepts.autoSuggestThreshold': {
    type: 'integer',
    default: 3,
    required: false,
    constraints: { min: 1, max: 20 },
  },

  // ── webSearch ──
  'webSearch.enabled': {
    type: 'boolean',
    default: false,
    required: false,
    envVar: 'ABYSSAL_WEB_SEARCH_ENABLED',
  },
  'webSearch.backend': {
    type: 'enum',
    default: 'tavily',
    required: false,
    constraints: { enum: ['tavily', 'serpapi', 'bing'] },
    envVar: 'ABYSSAL_WEB_SEARCH_BACKEND',
  },

  // ── logging ──
  'logging.level': {
    type: 'enum',
    default: 'info',
    required: false,
    constraints: { enum: ['debug', 'info', 'warn', 'error'] },
    cliFlag: '--log-level',
    envVar: 'ABYSSAL_LOGGING_LEVEL',
  },

  // ── notes (v1.3) ──
  'notes.memoMaxLength': {
    type: 'integer',
    default: 500,
    required: false,
    constraints: { min: 50, max: 2000 },
  },
  'notes.memoAutoIndex': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'notes.noteAutoIndex': {
    type: 'boolean',
    default: true,
    required: false,
  },
  'notes.notesDirectory': {
    type: 'string',
    default: 'notes',
    required: false,
  },
};

// ─── 关联约束 ───

export interface CrossFieldConstraint {
  description: string;
  validate: (config: Record<string, unknown>) => string | null;
}

export const CROSS_FIELD_CONSTRAINTS: CrossFieldConstraint[] = [
  {
    description: 'focusedMaxTokens < broadMaxTokens',
    validate: (c) => {
      const focused = getNestedValue(c, 'contextBudget.focusedMaxTokens') as number | undefined;
      const broad = getNestedValue(c, 'contextBudget.broadMaxTokens') as number | undefined;
      if (focused !== undefined && broad !== undefined && focused >= broad) {
        return `contextBudget.focusedMaxTokens (${focused}) must be less than contextBudget.broadMaxTokens (${broad})`;
      }
      return null;
    },
  },
  {
    description: 'overlapTokens < maxTokensPerChunk',
    validate: (c) => {
      const overlap = getNestedValue(c, 'analysis.overlapTokens') as number | undefined;
      const chunkMax = getNestedValue(c, 'analysis.maxTokensPerChunk') as number | undefined;
      if (overlap !== undefined && chunkMax !== undefined && overlap >= chunkMax) {
        return `analysis.overlapTokens (${overlap}) must be less than analysis.maxTokensPerChunk (${chunkMax})`;
      }
      return null;
    },
  },
  {
    description: 'outputReserveRatio + safetyMarginRatio < 0.5',
    validate: (c) => {
      const reserve = getNestedValue(c, 'contextBudget.outputReserveRatio') as number | undefined;
      const margin = getNestedValue(c, 'contextBudget.safetyMarginRatio') as number | undefined;
      if (reserve !== undefined && margin !== undefined && reserve + margin >= 0.5) {
        return `contextBudget.outputReserveRatio (${reserve}) + safetyMarginRatio (${margin}) must be < 0.5`;
      }
      return null;
    },
  },
];

// ─── 类型强制转换 ───

export function coerceToSchemaType(value: unknown, fieldDef: FieldDefinition): unknown {
  if (value === null || value === undefined) return value;

  switch (fieldDef.type) {
    case 'float':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const n = parseFloat(value);
        return Number.isNaN(n) ? value : n;
      }
      return value;

    case 'integer':
      if (typeof value === 'number') return Math.round(value);
      if (typeof value === 'string') {
        const n = parseInt(value, 10);
        return Number.isNaN(n) ? value : n;
      }
      return value;

    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return ['true', '1', 'yes'].includes(value.toLowerCase());
      }
      return value;

    case 'string':
      if (typeof value === 'number') return String(value);
      return value;

    case 'string[]':
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === 'string') return value.split(',').map((s) => s.trim());
      return value;

    case 'enum':
      return value;

    default:
      return value;
  }
}

// ─── 工具函数 ───

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function usesProvider(config: Record<string, unknown>, provider: string): boolean {
  const defaultProvider = getNestedValue(config, 'llm.defaultProvider') as string | undefined;
  if (defaultProvider === provider) return true;
  const overrides = getNestedValue(config, 'llm.workflowOverrides') as Record<string, { provider?: string }> | undefined;
  if (overrides) {
    for (const o of Object.values(overrides)) {
      if (o.provider === provider) return true;
    }
  }
  return false;
}
