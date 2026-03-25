/**
 * ServiceContainer — 主进程核心服务的统一管理
 *
 * 职责：
 * 1. 按依赖顺序初始化服务
 * 2. 提供类型安全的服务访问
 * 3. 应用退出时按反向顺序关闭
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { ConsoleLogger, type Logger } from '../core/infra/logger';
import { ConfigLoader } from '../core/infra/config';
import { createDatabaseService, type DatabaseService } from '../core/database';
import { createBibliographyService, type BibliographyService } from '../core/bibliography';
import type { AbyssalConfig } from '../core/types/config';

export interface ServiceContainer {
  readonly logger: Logger;
  readonly config: AbyssalConfig;
  readonly dbService: DatabaseService;
  readonly biblioService: BibliographyService;
}

/** 最小默认配置（无 TOML 文件时使用） */
function createDefaultConfig(workspaceDir: string): AbyssalConfig {
  return {
    workspace: { baseDir: workspaceDir, dbFileName: 'abyssal.db', pdfDir: 'pdfs', notesDir: 'notes', snapshotsDir: 'snapshots' },
    llm: { provider: 'stub', model: 'stub', apiKey: '', maxTokens: 4096, temperature: 0.7 },
    rag: {
      embeddingModel: 'stub', embeddingDimension: 384, expandFactor: 2,
      rerankerBackend: 'none' as const, correctiveRagEnabled: false,
    },
    acquire: { perSourceTimeoutMs: 30000, enableScihub: false, institutionalProxyUrl: null, scihubDomain: null },
    process: { ocrEnabled: true, ocrLanguages: ['eng'], vlmEnabled: false },
    bibliography: { defaultStyle: 'apa', stylesDir: '' },
    search: {},
    apiKeys: { openalexEmail: null, unpaywallEmail: null, semanticScholarApiKey: null, cohereApiKey: null, jinaApiKey: null },
    logging: { level: 'info' as const, file: null },
    advanced: {},
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * 初始化全部核心服务。
 * 如果 DB 初始化失败会自动清理旧文件并重试一次。
 */
export function initServiceContainer(): ServiceContainer {
  const logger: Logger = new ConsoleLogger('info');
  const userDataPath = app.getPath('userData');
  const workspaceDir = path.join(userDataPath, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  // 配置
  let config: AbyssalConfig;
  const configPath = path.join(userDataPath, 'abyssal.toml');
  if (fs.existsSync(configPath)) {
    try {
      config = ConfigLoader.load(configPath);
    } catch (err) {
      logger.warn('Config load failed, using defaults', { error: (err as Error).message });
      config = createDefaultConfig(workspaceDir);
    }
  } else {
    config = createDefaultConfig(workspaceDir);
  }

  // 数据库（含自动重试）
  const dbPath = path.join(workspaceDir, config.workspace.dbFileName);
  const migrationsDir = path.resolve(__dirname, '..', 'core', 'database', 'migrations');
  let dbService: DatabaseService;

  try {
    dbService = createDatabaseService({ dbPath, config, logger, skipVecExtension: true, migrationsDir });
    logger.info('Database initialized', { dbPath });
  } catch (err) {
    logger.error('Database init failed, retrying with fresh DB', err as Error);
    for (const suffix of ['', '-wal', '-shm']) {
      const f = dbPath + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    dbService = createDatabaseService({ dbPath, config, logger, skipVecExtension: true, migrationsDir });
    logger.info('Database initialized (fresh)', { dbPath });
  }

  // Bibliography
  const biblioService = createBibliographyService(config, logger);

  logger.info('All core services initialized');
  return { logger, config, dbService, biblioService };
}

/** 关闭服务（app quit 前调用） */
export function shutdownServices(container: ServiceContainer): void {
  try { container.dbService.close(); } catch { /* ignore */ }
  container.logger.info('Services shut down');
}
