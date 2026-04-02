/**
 * 集成测试用数据库工厂 — 基于 migration 系统构建 schema。
 *
 * 与旧 mock-db.ts 的区别：
 * - 使用真实的 migration 文件（001→005），保证 schema 与生产一致
 * - skipVecExtension=true 跳过 sqlite-vec（避免 ABI 冲突）
 * - 每个测试获得独立的 :memory: 实例，互不影响
 */

import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../core/database/migration';
import type { AbyssalConfig } from '../core/types/config';
import type { Logger } from '../core/infra/logger';

/** 静默 Logger——测试中不打印日志 */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** 测试用最小配置——字段与 AbyssalConfig 接口严格对齐 */
export function createTestConfig(overrides?: Partial<AbyssalConfig>): AbyssalConfig {
  return {
    project: { name: 'test-project', description: '', mode: 'auto' },
    workspace: {
      baseDir: '/tmp/test-workspace',
      dbFileName: ':memory:',
      pdfDir: 'pdfs/',
      textDir: 'texts/',
      reportsDir: 'reports/',
      notesDir: 'notes/',
      logsDir: 'logs/',
      snapshotsDir: 'snapshots/',
      privateDocsDir: 'private_docs/',
    },
    acquire: {
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
    },
    discovery: {
      traversalDepth: 2,
      concurrency: 5,
      maxResultsPerQuery: 100,
    },
    analysis: {
      templateDir: 'templates/',
      maxTokensPerChunk: 1024,
      overlapTokens: 128,
      ocrEnabled: false,
      ocrLanguages: ['eng'],
      charDensityThreshold: 10,
      vlmEnabled: false,
      autoSuggestConcepts: true,
    },
    rag: {
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 4, // 极小维度，测试用
      embeddingProvider: 'openai',
      defaultTopK: 10,
      expandFactor: 3,
      rerankerBackend: 'cohere',
      rerankerModel: null,
      tentativeExpandFactorMultiplier: 2.0,
      tentativeTopkMultiplier: 1.5,
      correctiveRagEnabled: false,
      correctiveRagMaxRetries: 0,
      correctiveRagModel: 'deepseek-chat',
      crossConceptBoostFactor: 1.5,
    },
    language: {
      internalWorkingLanguage: 'en',
      defaultOutputLanguage: 'zh-CN',
      uiLocale: 'en',
    },
    llm: {
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
      workflowOverrides: {},
    },
    apiKeys: {
      anthropicApiKey: 'test-key',
      openaiApiKey: null,
      geminiApiKey: null,
      deepseekApiKey: null,
      semanticScholarApiKey: null,
      openalexEmail: null,
      unpaywallEmail: null,
      cohereApiKey: null,
      jinaApiKey: null,
      siliconflowApiKey: null,
      webSearchApiKey: null,
    },
    concepts: {
      additiveChangeLookbackDays: 30,
      autoSuggestThreshold: 3,
    },
    contextBudget: {
      focusedMaxTokens: 50_000,
      broadMaxTokens: 100_000,
      outputReserveRatio: 0.15,
      safetyMarginRatio: 0.05,
      skipRerankerThreshold: 0.8,
      costPreference: 'balanced',
    },
    conceptChange: {
      jaccardThreshold: 0.5,
      additiveReviewWindowDays: 30,
      autoDetectBreaking: true,
    },
    notes: {
      memoMaxLength: 500,
      memoAutoIndex: true,
      noteAutoIndex: true,
      notesDirectory: 'notes',
    },
    batch: {
      concurrency: 2,
    },
    advisory: {
      minPapersThreshold: 5,
    },
    logging: {
      level: 'info',
    },
    writing: {
      defaultCslStyleId: 'gb-t-7714',
      defaultOutputLanguage: 'zh',
      cslStylesDir: '',
      cslLocalesDir: '',
    },
    personalization: {
      authorDisplayThreshold: 1,
    },
    ai: {
      proactiveSuggestions: false,
    },
    webSearch: {
      enabled: false,
      backend: 'tavily',
    },
    ...overrides,
  };
}

/** 迁移文件目录 */
export const MIGRATIONS_DIR = path.resolve(__dirname, '../core/database/migrations');

/**
 * 创建内存数据库并运行全部 migration。
 *
 * 使用方式：
 * ```ts
 * let db: Database.Database;
 * beforeEach(async () => { db = await createTestDB(); });
 * afterEach(() => { db.close(); });
 * ```
 */
export function createTestDB(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const config = createTestConfig();
  try {
    runMigrations(db, MIGRATIONS_DIR, config, silentLogger, /* skipVecExtension */ true);
  } catch (err) {
    db.close();
    throw new Error(`createTestDB migration failed: ${(err as Error).message}`, { cause: err });
  }

  return db;
}
