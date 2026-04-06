import { createEmbedFunction, type ReactiveEmbedFunction } from '../adapter/llm-client/embed-function-factory';
import { ConfigProvider } from '../core/infra/config-provider';
import { ConsoleLogger, FileLogger, type Logger, type LogLevel } from '../core/infra/logger';
import { createDatabaseService, type DatabaseService } from '../core/database';
import { createRagService, type RagService } from '../core/rag';
import { getWorkspacePaths } from '../core/workspace';
import type { AbyssalConfig } from '../core/types/config';
import type {
  RagInitPayload,
  RagLifecycleRequest,
  RagLifecycleResponse,
  RagRequest,
  RagResponse,
  RagRuntimeState,
  RagUpdateConfigPayload,
} from './protocol';

type ProcessWithSend = NodeJS.Process & {
  send?: (message: RagLifecycleResponse | RagResponse) => void;
};

const proc = process as ProcessWithSend;

let logger: Logger = new ConsoleLogger('info');
let configProvider: ConfigProvider | null = null;
let embedFn: ReactiveEmbedFunction | null = null;
let dbService: DatabaseService | null = null;
let ragService: RagService | null = null;
let workspaceRoot: string | null = null;

function send(message: RagLifecycleResponse | RagResponse): void {
  proc.send?.(message);
}

function createLogger(root: string, level: LogLevel = 'info'): Logger {
  try {
    return new FileLogger(getWorkspacePaths(root).logs, level);
  } catch {
    return new ConsoleLogger(level);
  }
}

function getRuntimeState(): RagRuntimeState {
  return {
    available: ragService !== null,
    degraded: ragService?.degraded ?? false,
    degradedReason: ragService?.degradedReason ?? null,
  };
}

function disposeRuntime(): void {
  ragService = null;
  try {
    embedFn?.dispose();
  } catch {
    // ignore embed function teardown failures
  }
  embedFn = null;
  try {
    dbService?.close();
  } catch {
    // ignore DB close failures during teardown
  }
  dbService = null;
  configProvider = null;
}

function ensureRagService(): RagService {
  if (!ragService) {
    throw new Error('RAG module not initialized');
  }
  return ragService;
}

function initializeRuntime(payload: RagInitPayload): RagRuntimeState {
  disposeRuntime();

  workspaceRoot = payload.workspaceRoot;
  logger = createLogger(payload.workspaceRoot, payload.logLevel ?? 'info');
  configProvider = new ConfigProvider(payload.config);
  embedFn = createEmbedFunction({ configProvider, logger });
  dbService = createDatabaseService({
    dbPath: getWorkspacePaths(payload.workspaceRoot).db,
    config: payload.config,
    logger,
    readOnly: false,
    skipFileLock: true,
  });

  ragService = embedFn.isAvailable
    ? createRagService(embedFn, dbService, payload.config, logger)
    : null;

  logger.info('RAG subprocess initialized', {
    workspaceRoot: payload.workspaceRoot,
    available: ragService !== null,
    provider: payload.config.rag.embeddingProvider,
    model: payload.config.rag.embeddingModel,
  });

  return getRuntimeState();
}

function updateRuntimeConfig(payload: RagUpdateConfigPayload): RagRuntimeState {
  if (!configProvider || !embedFn || !dbService) {
    throw new Error('RAG runtime not initialized');
  }

  configProvider.update(payload.config);
  ragService = embedFn.isAvailable
    ? createRagService(embedFn, dbService, payload.config, logger)
    : null;

  logger.info('RAG subprocess config updated', {
    available: ragService !== null,
    provider: payload.config.rag.embeddingProvider,
    model: payload.config.rag.embeddingModel,
  });

  return getRuntimeState();
}

async function handleLifecycle(msg: RagLifecycleRequest): Promise<void> {
  try {
    if (msg.action === 'init') {
      const state = initializeRuntime(msg.payload as RagInitPayload);
      send({ type: 'lifecycle', action: 'init', success: true, state });
      return;
    }

    if (msg.action === 'update-config') {
      const state = updateRuntimeConfig(msg.payload as RagUpdateConfigPayload);
      send({ type: 'lifecycle', action: 'update-config', success: true, state });
      return;
    }

    if (msg.action === 'close') {
      disposeRuntime();
      send({ type: 'lifecycle', action: 'close', success: true, state: getRuntimeState() });
      return;
    }

    send({ type: 'lifecycle', action: msg.action, success: false, error: `Unsupported lifecycle action: ${msg.action}` });
  } catch (err) {
    send({
      type: 'lifecycle',
      action: msg.action,
      success: false,
      error: (err as Error).message,
      state: getRuntimeState(),
    });
  }
}

async function handleRequest(msg: RagRequest): Promise<void> {
  try {
    const service = ensureRagService();
    let result: unknown;

    switch (msg.method) {
      case 'embedAndIndexChunks':
        result = await service.embedAndIndexChunks(msg.args[0] as Parameters<RagService['embedAndIndexChunks']>[0]);
        break;
      case 'searchSemantic':
        result = await service.searchSemantic(
          msg.args[0] as Parameters<RagService['searchSemantic']>[0],
          msg.args[1] as Parameters<RagService['searchSemantic']>[1],
          msg.args[2] as Parameters<RagService['searchSemantic']>[2],
        );
        break;
      case 'retrieve':
        result = await service.retrieve(msg.args[0] as Parameters<RagService['retrieve']>[0]);
        break;
      case 'getDiagnosticsSummary':
        result = service.getDiagnosticsSummary();
        break;
      default:
        throw new Error(`Unsupported RAG method: ${msg.method}`);
    }

    send({ id: msg.id, result });
  } catch (err) {
    const error = err as Error;
    send({
      id: msg.id,
      error: {
        name: error.name,
        message: error.message,
      },
    });
  }
}

process.on('message', (message: RagLifecycleRequest | RagRequest) => {
  if (!message || typeof message !== 'object') return;
  if ((message as RagLifecycleRequest).type === 'lifecycle') {
    void handleLifecycle(message as RagLifecycleRequest);
    return;
  }
  void handleRequest(message as RagRequest);
});

process.on('disconnect', () => {
  disposeRuntime();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disposeRuntime();
  process.exit(0);
});

send({ type: 'lifecycle', action: 'ready', success: true, state: getRuntimeState() });