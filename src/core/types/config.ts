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
  embeddingBackend: 'api' | 'local-onnx';
  embeddingModel: string; // 默认 "text-embedding-3-small"
  embeddingDimension: number; // 默认 1536
  defaultTopK: number; // 默认 10
  expandFactor: number; // 默认 3
  rerankerBackend: 'api-cohere' | 'api-jina' | 'local-bge';
  rerankerModel: string | null;
  tentativeExpandFactorMultiplier: number; // 默认 2.0
  tentativeTopkMultiplier: number; // 默认 1.5
  correctiveRagEnabled: boolean; // 默认 true
  correctiveRagMaxRetries: number; // 默认 2
  correctiveRagModel: string; // 默认 "deepseek-chat"
  localOnnxModelPath: string | null;
  localRerankerModelPath: string | null;
}

export interface LanguageConfig {
  internalWorkingLanguage: string; // 固定 "en"
  defaultOutputLanguage: string; // 默认 "zh-CN"
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

// ═══ 全局配置（存储在 AppData，跨工作区共享） ═══

export interface GlobalConfig {
  apiKeys: ApiKeysConfig;
  llm: LlmConfig;
  rag: RagConfig;
  acquire: AcquireConfig;
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
}
