// ═══ 字面量联合 + const 数组 ═══

export const PROJECT_MODES = ['anchored', 'unanchored', 'auto'] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

export const SEED_TYPES = ['axiom', 'milestone', 'exploratory'] as const;
export type SeedType = (typeof SEED_TYPES)[number];

// ═══ 配置段类型 ═══

export interface ProjectConfig {
  name: string;
  description: string; // 默认 ""
  mode: ProjectMode; // 默认 "auto"
}

export interface AcquireConfig {
  enabledSources: string[]; // 默认 ["unpaywall", "arxiv", "pmc"]
  enableScihub: boolean;
  scihubDomain: string | null;
  institutionalProxyUrl: string | null;
  perSourceTimeoutMs: number; // 默认 30000
  maxRedirects: number; // 默认 5
  // Retry strategy
  maxRetries: number; // 默认 1，仅对可重试错误（5xx/timeout）生效
  retryDelayMs: number; // 默认 2000，重试间隔
  scihubMaxTotalMs: number; // 默认 60000，Scihub 多域名探测总超时上限
  tarMaxExtractBytes: number; // 默认 209715200 (200MB)，PMC tar 解压大小限制
  // Feature 1: LLM content sanity check
  enableContentSanityCheck: boolean; // 默认 false
  sanityCheckMaxChars: number; // 默认 2000
  sanityCheckConfidenceThreshold: number; // 默认 0.85
  // Feature 2: Failure mode memory
  enableFailureMemory: boolean; // 默认 true
  failureMemoryWindowDays: number; // 默认 90
  // Feature 3: Fuzzy identifier resolution
  enableFuzzyResolve: boolean; // 默认 true
  fuzzyResolveConfidenceThreshold: number; // 默认 0.8
  // Feature 4: China institutional access (CARSI)
  enableChinaInstitutional: boolean; // 默认 false
  chinaInstitutionId: string | null; // 大学标识，如 "zju"
  chinaCustomIdpEntityId: string | null; // 自定义 IdP entityID（非预置大学时使用）
  // Feature 5: Chinese academic databases (CNKI/Wanfang)
  enableCnki: boolean; // 默认 false，需要 CARSI 登录后的 cookie
  enableWanfang: boolean; // 默认 false，需要 CARSI 登录后的 cookie
  // ── Pipeline v2: 4-Layer Intelligent Acquire ──
  // Layer 0: Fast Path — DOI 前缀正则直接构造 OA URL
  enableFastPath: boolean; // 默认 true
  // Layer 1: Recon — 并行 DOI HEAD + OpenAlex + CrossRef
  enableRecon: boolean; // 默认 true
  reconCacheTtlDays: number; // 默认 30，稳定数据（出版商域名、仓库 URL）缓存 TTL
  oaCacheRefreshDays: number; // 默认 7，OA 状态刷新周期（封锁期后可能变 OA）
  reconTimeoutMs: number; // 默认 10000，Recon 每数据源超时
  // Preflight — HEAD 请求检测 Content-Type，防止假 OA 陷阱
  enablePreflight: boolean; // 默认 true
  preflightTimeoutMs: number; // 默认 5000
  // Layer 2+3: Strategy + Speculative Execution
  enableSpeculativeExecution: boolean; // 默认 true，启用 Promise.any 并行下载
  maxSpeculativeParallel: number; // 默认 3，投机并行候选数
  speculativeTotalTimeoutMs: number; // 默认 45000，投机阶段总超时
  // EZProxy URL 变异模板，如 "https://{hostname}.ezproxy.lib.uni.edu/{path}"
  ezproxyUrlTemplate: string | null; // 默认 null
  // ── 代理配置 ──
  proxyEnabled: boolean; // 默认 false
  // 支持 http://, https://, socks5:// 协议
  // 例：socks5://127.0.0.1:7890, http://user:pass@proxy.example.com:8080
  proxyUrl: string; // 默认 'socks5://127.0.0.1:7890'
  // 'all' = 全部请求走代理; 'blocked-only' = 仅被封锁源走代理(scihub, doi HEAD 等)
  proxyMode: 'all' | 'blocked-only'; // 默认 'blocked-only'
}

export interface DiscoveryConfig {
  traversalDepth: number; // 默认 2
  concurrency: number; // 默认 5
  maxResultsPerQuery: number; // 默认 100
}

export interface AnalysisConfig {
  templateDir: string; // 默认 "templates/"
  maxTokensPerChunk: number; // 默认 1024
  overlapTokens: number; // 默认 128
  ocrEnabled: boolean; // 默认 true
  ocrLanguages: string[]; // 默认 ["eng", "chi_sim"]
  charDensityThreshold: number; // 默认 10
  vlmEnabled: boolean; // 默认 false
  autoSuggestConcepts: boolean; // 默认 true
}

export interface RagConfig {
  embeddingModel: string; // 默认 "text-embedding-3-small"
  embeddingDimension: number; // 默认 1536
  defaultTopK: number; // 默认 10
  expandFactor: number; // 默认 3
  embeddingProvider: 'openai' | 'siliconflow'; // 默认 "openai"
  rerankerBackend: 'cohere' | 'jina' | 'siliconflow';
  rerankerModel: string | null;
  tentativeExpandFactorMultiplier: number; // 默认 2.0
  tentativeTopkMultiplier: number; // 默认 1.5
  correctiveRagEnabled: boolean; // 默认 true
  correctiveRagMaxRetries: number; // 默认 2
  correctiveRagModel: string; // 默认 "deepseek-chat"
  crossConceptBoostFactor: number; // 默认 1.5，跨概念交叉论文的 score boost 系数
}

export interface LanguageConfig {
  internalWorkingLanguage: string; // 固定 "en"
  defaultOutputLanguage: string; // 默认 "zh-CN"
  uiLocale: string; // 默认 "en"，界面语言
}

export interface LlmOverride {
  provider: string;
  model: string;
  maxTokens?: number | undefined;
}

export interface LlmConfig {
  defaultProvider: string; // 默认 "anthropic"
  defaultModel: string; // 默认 "claude-sonnet-4-20250514"
  workflowOverrides: Record<string, LlmOverride>;
}

export interface ApiKeysConfig {
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  deepseekApiKey: string | null;
  semanticScholarApiKey: string | null;
  openalexEmail: string | null;
  unpaywallEmail: string | null;
  cohereApiKey: string | null;
  jinaApiKey: string | null;
  siliconflowApiKey: string | null;
  /** Web 搜索 API key（Tavily / SerpAPI / Bing） */
  webSearchApiKey: string | null;
}

export interface WorkspaceConfig {
  baseDir: string; // 必填
  dbFileName: string; // 默认 "abyssal.db"
  pdfDir: string; // 默认 "pdfs/"
  textDir: string; // 默认 "texts/"
  reportsDir: string; // 默认 "reports/"
  notesDir: string; // 默认 "notes/"
  logsDir: string; // 默认 "logs/"
  snapshotsDir: string; // 默认 "snapshots/"
  privateDocsDir: string; // 默认 "private_docs/"
}

export interface ConceptsConfig {
  additiveChangeLookbackDays: number; // 默认 30
  autoSuggestThreshold: number; // 默认 3
}

export interface ContextBudgetConfig {
  focusedMaxTokens: number; // 默认 50000
  broadMaxTokens: number; // 默认 100000
  outputReserveRatio: number; // 默认 0.15
  safetyMarginRatio: number; // 默认 0.05
  skipRerankerThreshold: number; // 默认 0.8
  costPreference: 'aggressive' | 'balanced' | 'conservative'; // 默认 "balanced"
}

// COST_PREFERENCES / CostPreference 定义在 retrieval.ts，此处不再重复。

export interface ConceptChangeConfig {
  jaccardThreshold: number; // 默认 0.5，范围 [0.0, 1.0]
  additiveReviewWindowDays: number; // 默认 30，范围 [7, 180]
  autoDetectBreaking: boolean; // 默认 true
}

export interface BatchConfig {
  concurrency: number; // 默认 5
}

export interface AdvisoryConfig {
  minPapersThreshold: number; // 默认 5
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error'; // 默认 "info"
}

export interface NotesConfig {
  memoMaxLength: number; // 默认 500，范围 [50, 2000]
  memoAutoIndex: boolean; // 默认 true
  noteAutoIndex: boolean; // 默认 true
  notesDirectory: string; // 默认 "notes"（相对于 workspace）
}

export interface WebSearchConfig {
  /** 是否启用 Web 搜索 */
  enabled: boolean; // 默认 false
  /** 搜索后端：tavily | serpapi | bing */
  backend: 'tavily' | 'serpapi' | 'bing'; // 默认 "tavily"
}

// ═══ 全局配置（存储在 AppData，跨工作区共享） ═══

export interface GlobalConfig {
  apiKeys: ApiKeysConfig;
  llm: LlmConfig;
  rag: RagConfig;
  acquire: AcquireConfig;
  webSearch?: WebSearchConfig;
}

// ═══ 个性化配置 ═══

export interface PersonalizationConfig {
  /** 作者 et al. 阈值：超过此数量时缩写为 "et al."；0 = 始终全部显示 */
  authorDisplayThreshold: number;
}

// ═══ AbyssalConfig 顶层（合并后的运行时配置） ═══

export interface AbyssalConfig {
  project: ProjectConfig;
  acquire: AcquireConfig;
  discovery: DiscoveryConfig;
  analysis: AnalysisConfig;
  rag: RagConfig;
  language: LanguageConfig;
  llm: LlmConfig;
  apiKeys: ApiKeysConfig;
  workspace: WorkspaceConfig;
  concepts: ConceptsConfig;
  contextBudget: ContextBudgetConfig;
  conceptChange: ConceptChangeConfig;
  notes: NotesConfig;
  batch: BatchConfig;
  advisory: AdvisoryConfig;
  logging: LoggingConfig;
  writing: WritingConfig;
  personalization: PersonalizationConfig;
  webSearch: WebSearchConfig;
}

// ═══ 写作配置 ═══

export interface WritingConfig {
  /** 默认 CSL 引用样式 ID（如 "gb-t-7714", "apa", "ieee"） */
  defaultCslStyleId: string;
  /** 默认输出语言（BCP 47，如 "zh", "en"） */
  defaultOutputLanguage: string;
}
