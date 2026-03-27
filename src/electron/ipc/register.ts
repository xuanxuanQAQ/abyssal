/**
 * Unified IPC handler registration entry point.
 *
 * Provides:
 * - wrapHandler: uniform error catching, structured error conversion,
 *   logging, and timeout protection for all IPC handlers
 * - registerAllHandlers: iterates all namespace handler modules
 *   and calls their register() function
 *
 * See spec: section 4 — IPC Handler Unified Registration Pattern
 */

import { ipcMain } from 'electron';
import type { AppContext } from '../app-context';
import { AbyssalError } from '../../core/types/errors';
import type { Logger } from '../../core/infra/logger';

// ─── IPC Response envelope ───

export interface IPCResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    context?: Record<string, unknown>;
  };
}

// ─── Timeout sentinel ───

class IPCTimeoutError extends Error {
  constructor(ms: number) {
    super(`IPC operation timed out after ${ms}ms`);
    this.name = 'IPCTimeoutError';
  }
}

// ─── JSON-safe sanitization ───

/**
 * Deep-sanitize a value to ensure it's 100% JSON-safe (Plain Old Data).
 *
 * - Date → ISO 8601 string
 * - Map → plain object
 * - Set → array
 * - Buffer → Uint8Array (Structured Clone supports this)
 * - Class instances → plain objects (strips prototype)
 * - undefined values in objects → omitted (JSON.parse(JSON.stringify) semantics)
 *
 * This prevents contextBridge Structured Clone from silently corrupting data.
 */
function sanitizeForIPC(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value; // primitives are safe

  // Date → ISO string
  if (value instanceof Date) return value.toISOString();

  // Map → plain object
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) obj[String(k)] = sanitizeForIPC(v);
    return obj;
  }

  // Set → array
  if (value instanceof Set) return Array.from(value).map(sanitizeForIPC);

  // Array
  if (Array.isArray(value)) return value.map(sanitizeForIPC);

  // Float32Array / other TypedArrays → regular array
  if (ArrayBuffer.isView(value) && !(value instanceof Uint8Array)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }

  // Plain object or class instance → strip to plain object
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) result[k] = sanitizeForIPC(v);
  }
  return result;
}

// ─── wrapHandler ───

export interface WrapHandlerOptions {
  /** Timeout in ms. Default: 30000 (30s) */
  timeoutMs?: number;
}

/**
 * Wrap an IPC handler with unified error handling, logging, and timeout.
 *
 * Returns { ok: true, data } on success, { ok: false, error } on failure.
 * The renderer-side preload unwraps this envelope.
 */
export function wrapHandler<T>(
  channel: string,
  logger: Logger,
  handlerFn: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<T>,
  options?: WrapHandlerOptions,
): (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<IPCResponse<T>> {
  const timeoutMs = options?.timeoutMs ?? 30_000;

  return async (event, ...args) => {
    const startTime = Date.now();
    logger.debug(`IPC call: ${channel}`, {
      argsPreview: JSON.stringify(args).slice(0, 200),
    });

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new IPCTimeoutError(timeoutMs)), timeoutMs);
      });

      const result = await Promise.race([
        handlerFn(event, ...args),
        timeoutPromise,
      ]);

      logger.debug(`IPC response: ${channel}`, {
        durationMs: Date.now() - startTime,
      });

      // Sanitize result to plain JSON-safe data.
      // Strips Date objects (→ ISO strings), class instances (→ plain objects),
      // undefined values, and any non-serializable types that would break
      // Electron's contextBridge Structured Clone.
      const safeData = sanitizeForIPC(result);

      return { ok: true, data: safeData as T };
    } catch (error: unknown) {
      if (error instanceof IPCTimeoutError) {
        logger.warn(`IPC timeout: ${channel}`, { timeoutMs });
        return {
          ok: false,
          error: {
            code: 'IPC_TIMEOUT',
            message: 'Operation timed out',
            recoverable: true,
          },
        };
      }

      if (AbyssalError.isAbyssalError(error)) {
        const abyssalErr = error as AbyssalError;
        logger.warn(`IPC error: ${channel}`, {
          code: abyssalErr.code,
          message: abyssalErr.message,
        });
        return {
          ok: false,
          error: {
            code: abyssalErr.code,
            message: abyssalErr.message,
            recoverable: abyssalErr.recoverable,
            context: abyssalErr.context,
          },
        };
      }

      // Unexpected error
      const err = error as Error;
      logger.error(`IPC unexpected error: ${channel}`, err, {
        durationMs: Date.now() - startTime,
      });
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message ?? 'Unknown error',
          recoverable: false,
        },
      };
    }
  };
}

// ─── Handler registration helper ───

/**
 * Register a single IPC request-response channel with wrapHandler.
 * Prefer `typedHandler()` for contract-driven channels.
 * Used by non-contract handlers (acquire, bibliography, process).
 */
export function registerHandler<T>(
  channel: string,
  logger: Logger,
  handlerFn: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<T>,
  options?: WrapHandlerOptions,
): void {
  ipcMain.handle(channel, wrapHandler(channel, logger, handlerFn, options));
}

// ─── Typed handler registration (contract-driven) ───

import type { IpcChannel, IpcArgs, IpcResult } from '../../shared-types/ipc/contract';

const registeredChannels = new Set<string>();

/**
 * Type-safe IPC handler registration driven by IpcContract.
 *
 * - Args and result types are inferred from the contract — no manual casts needed.
 * - Duplicate channel registration throws immediately (fail-fast).
 * - Wraps with the same wrapHandler (timeout, error envelope, sanitization).
 */
export function typedHandler<C extends IpcChannel>(
  channel: C,
  logger: Logger,
  handlerFn: (event: Electron.IpcMainInvokeEvent, ...args: IpcArgs<C>) => Promise<IpcResult<C>>,
  options?: WrapHandlerOptions,
): void {
  if (registeredChannels.has(channel)) {
    throw new Error(`Duplicate IPC handler: ${channel}`);
  }
  registeredChannels.add(channel);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcMain.handle(channel, wrapHandler(channel, logger, handlerFn as any, options));
}

// ─── Bulk registration of all namespace handlers ───

import { registerPapersHandlers } from './papers-handler';
import { registerSearchHandlers } from './search-handler';
import { registerAcquireHandlers } from './acquire-handler';
import { registerProcessHandlers } from './process-handler';
import { registerConceptsHandlers } from './concepts-handler';
import { registerMappingsHandlers } from './mappings-handler';
import { registerAnnotationsHandlers } from './annotations-handler';
import { registerRagHandlers } from './rag-handler';
import { registerBibliographyHandlers } from './bibliography-handler';
import { registerWorkflowsHandlers } from './workflows-handler';
import { registerAgentHandlers } from './agent-handler';
import { registerArticlesHandlers } from './articles-handler';
import { registerSnapshotsHandlers } from './snapshots-handler';
import { registerAdvisoryHandlers } from './advisory-handler';
import { registerMemosHandlers } from './memos-handler';
import { registerNotesHandlers } from './notes-handler';
import { registerConceptSuggestionsHandlers } from './concept-suggestions-handler';
import { registerSystemHandlers } from './system-handler';

/**
 * Register all IPC handlers for all namespaces.
 *
 * Called once during bootstrap Step 7. Handler registration order does not
 * matter — channels are declarative (Electron stores them for later dispatch).
 */
export function registerAllHandlers(ctx: AppContext): void {
  registerPapersHandlers(ctx);
  registerSearchHandlers(ctx);
  registerAcquireHandlers(ctx);
  registerProcessHandlers(ctx);
  registerConceptsHandlers(ctx);
  registerMappingsHandlers(ctx);
  registerAnnotationsHandlers(ctx);
  registerRagHandlers(ctx);
  registerBibliographyHandlers(ctx);
  registerWorkflowsHandlers(ctx);
  registerAgentHandlers(ctx);
  registerArticlesHandlers(ctx);
  registerSnapshotsHandlers(ctx);
  registerAdvisoryHandlers(ctx);
  registerMemosHandlers(ctx);
  registerNotesHandlers(ctx);
  registerConceptSuggestionsHandlers(ctx);
  registerSystemHandlers(ctx);

  ctx.logger.info('IPC handlers registered', { namespaces: 18 });
}
