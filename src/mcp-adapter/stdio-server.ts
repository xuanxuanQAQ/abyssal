// ═══ MCP Stdio Server ═══
// §2: 生命周期管理 — CLI 参数解析 → 初始化序列 → MCP Server → 优雅关闭
//
// 启动方式: npx tsx src/mcp-adapter/stdio-server.ts --config ./config/abyssal.toml
// 开发/调试专用，不进入 Electron 安装包。

// eslint-disable-next-line deprecation/deprecation — Server is deprecated but McpServer
// requires Zod schemas; Server + raw JSON Schema is simpler for generated definitions
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ConsoleLogger } from '../core/infra/logger';
import type { Logger } from '../core/infra/logger';
import { ConfigLoader } from '../core/infra/config';
import type { AbyssalConfig } from '../core/types/config';

import { createDatabaseService, type DatabaseService } from '../core/database';
import { createSearchService, type SearchService } from '../core/search';
import { createAcquireService, type AcquireService } from '../core/acquire';
import { createProcessService, type ProcessService } from '../core/process';
import { createRagService, type RagService } from '../core/rag';
import { createBibliographyService, type BibliographyService } from '../core/bibliography';

import { getToolDefinitions } from './tool-definitions';
import { handleToolCall, type ServiceContext } from './tool-handler';

import * as path from 'node:path';

// ─── §2.1 步骤 1: CLI 参数解析 ───

interface CliArgs {
  configPath: string;
  dbPath: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  readOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    configPath: '',
    dbPath: null,
    logLevel: 'info',
    readOnly: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];

    if (arg === '--config' || arg === '-c') {
      args.configPath = next ?? '';
      i++;
    } else if (arg.startsWith('--config=')) {
      args.configPath = arg.split('=')[1] ?? '';
    } else if (arg === '--db' || arg === '-d') {
      args.dbPath = next ?? null;
      i++;
    } else if (arg.startsWith('--db=')) {
      args.dbPath = arg.split('=')[1] ?? null;
    } else if (arg === '--log-level' || arg === '-l') {
      args.logLevel = (next ?? 'info') as CliArgs['logLevel'];
      i++;
    } else if (arg.startsWith('--log-level=')) {
      args.logLevel = (arg.split('=')[1] ?? 'info') as CliArgs['logLevel'];
    } else if (arg === '--read-only' || arg === '-r') {
      args.readOnly = true;
    }
  }

  if (!args.configPath) {
    process.stderr.write('Error: --config is required\n');
    process.stderr.write('Usage: npx tsx src/mcp-adapter/stdio-server.ts --config <path.toml>\n');
    process.exit(1);
  }

  return args;
}

// ─── §2.1 主启动函数 ───

async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv);

  // 步骤 3: 日志初始化（输出到 stderr，不干扰 JSON-RPC）
  const logger: Logger = new ConsoleLogger(cliArgs.logLevel);
  logger.info('Abyssal MCP Server starting', { config: cliArgs.configPath });

  // 步骤 2: 配置加载
  let config: AbyssalConfig;
  try {
    config = ConfigLoader.load(cliArgs.configPath);
  } catch (err) {
    logger.error('Config load failed', err as Error);
    process.exit(1);
  }

  // 步骤 4: 数据库初始化
  const dbPath = cliArgs.dbPath ??
    path.resolve(config.workspace.baseDir, config.workspace.dbFileName);

  // Fix #2: readonly 模式下正常打开 DB（不传 readonly:true 给 better-sqlite3），
  // 仅靠应用层的 Tool 拦截保证只读。因为 SQLite readonly 模式下 PRAGMA/迁移会抛错。
  let dbService: DatabaseService;
  try {
    dbService = createDatabaseService({
      dbPath,
      config,
      logger,
      skipVecExtension: false,
    });
    logger.info('Database connected', { dbPath, readOnly: cliArgs.readOnly });
  } catch (err) {
    logger.error('Database init failed', err as Error);
    process.exit(1);
  }

  // 步骤 5: 核心模块实例化
  const searchService: SearchService = createSearchService(config, logger);
  const acquireService: AcquireService = createAcquireService(config, logger);
  const processService: ProcessService = createProcessService(config, null); // VLM = null in MCP mode
  const bibliographyService: BibliographyService = createBibliographyService(config, logger);

  // RAG Service — EmbedFunction 需要 llm-client 实现
  // TODO: 当 llm-client 模块实现后，从 config 构建 EmbedFunction
  let ragService: RagService;
  try {
    const stubEmbedFn = {
      embed: async (_texts: string[]): Promise<Float32Array[]> => {
        throw new Error('EmbedFunction not configured — llm-client module not yet implemented');
      },
    };
    ragService = createRagService(stubEmbedFn, dbService, config, logger);
  } catch (err) {
    logger.warn('RAG service init failed, embedding tools will be unavailable', {
      error: (err as Error).message,
    });
    // Fix: 创建 stub RagService 而非 null — 所有方法抛出明确错误而不是 null deref
    ragService = new Proxy({} as RagService, {
      get(_target, prop) {
        if (typeof prop === 'string') {
          return () => { throw new Error(`RAG service unavailable: ${prop}() cannot be called (init failed)`); };
        }
        return undefined;
      },
    });
  }

  const startTime = Date.now();

  // ServiceContext
  const ctx: ServiceContext = {
    dbService,
    searchService,
    acquireService,
    processService,
    ragService,
    bibliographyService,
    logger,
    readOnly: cliArgs.readOnly,
    startTime,
  };

  // 步骤 6-7: MCP Server 启动 + Tool 注册
  const toolDefinitions = getToolDefinitions();

  // eslint-disable-next-line deprecation/deprecation
  const server = new Server(
    { name: 'abyssal', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions.map((t) => ({
      name: t.name,
      description: cliArgs.readOnly && t.isWriteOperation
        ? `${t.description} [READ-ONLY: disabled]`
        : t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const name: string = request.params.name;
    const args: Record<string, unknown> = request.params.arguments ?? {};
    return await handleToolCall(name, args, ctx) as any;
  });

  logger.info(`${toolDefinitions.length} tools registered`);

  // §2.2: 优雅关闭
  let isShuttingDown = false;

  async function gracefulShutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutting down...');

    // 等待进行中的请求（最多 10 秒）
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    try {
      // 释放 process Worker
      await processService.terminate();
    } catch {
      // 忽略
    }

    try {
      // WAL checkpoint + 关闭数据库
      dbService.walCheckpoint();
      dbService.close();
    } catch {
      // 忽略
    }

    try {
      await server.close();
    } catch {
      // 忽略
    }

    logger.info('Server stopped');
    process.exit(0);
  }

  process.on('SIGINT', () => { gracefulShutdown(); });
  process.on('SIGTERM', () => { gracefulShutdown(); });

  // 连接 stdio 传输
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Abyssal MCP Server ready (stdio transport)');
}

// ─── 入口 ───

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
