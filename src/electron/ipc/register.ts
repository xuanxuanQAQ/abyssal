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
function sanitizeForIPC(value: unknown, cache: WeakMap<object, unknown> = new WeakMap()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value; // primitives are safe

  // Check cache — avoid re-traversing the same object reference
  const cached = cache.get(value as object);
  if (cached !== undefined) return cached;

  // Date → ISO string
  if (value instanceof Date) {
    const result = value.toISOString();
    cache.set(value as object, result);
    return result;
  }

  if (value instanceof Map) {
    // Map → plain object
    const obj: Record<string, unknown> = {};
    cache.set(value as object, obj); // set early for circular refs
    for (const [k, v] of value) obj[String(k)] = sanitizeForIPC(v, cache);
    return obj;
  }

  if (value instanceof Set) {
    // Set → array
    const arr: unknown[] = [];
    cache.set(value as object, arr);
    for (const item of value) arr.push(sanitizeForIPC(item, cache));
    return arr;
  }

  if (Array.isArray(value)) {
    const arr = new Array(value.length);
    cache.set(value as object, arr);
    for (let i = 0; i < value.length; i++) arr[i] = sanitizeForIPC(value[i], cache);
    return arr;
  }

  if (ArrayBuffer.isView(value) && !(value instanceof Uint8Array)) {
    // Float32Array / other TypedArrays → regular array
    return Array.from(value as unknown as ArrayLike<number>);
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    // Uint8Array / ArrayBuffer — pass through for Structured Clone
    return value;
  }

  // Plain object or class instance → strip to plain object
  const obj: Record<string, unknown> = {};
  cache.set(value as object, obj);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) obj[k] = sanitizeForIPC(v, cache);
  }
  return obj;
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

    let timerId: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new IPCTimeoutError(timeoutMs)), timeoutMs);
      });

      const result = await Promise.race([
        handlerFn(event, ...args),
        timeoutPromise,
      ]);

      clearTimeout(timerId);

      logger.debug(`IPC response: ${channel}`, {
        durationMs: Date.now() - startTime,
      });

      // Sanitize result to plain JSON-safe data.
      const safeData = sanitizeForIPC(result);

      return { ok: true, data: safeData as T };
    } catch (error: unknown) {
      clearTimeout(timerId);

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

      // Unexpected error — propagate custom code/recoverable if present
      const err = error as Error;
      const errCode = typeof (err as any).code === 'string' ? (err as any).code : 'INTERNAL_ERROR';
      const errRecoverable = typeof (err as any).recoverable === 'boolean' ? (err as any).recoverable : false;
      logger.error(`IPC unexpected error: ${channel}`, err, {
        durationMs: Date.now() - startTime,
      });
      return {
        ok: false,
        error: {
          code: errCode,
          message: err.message ?? 'Unknown error',
          recoverable: errRecoverable,
          context: (err as any).context,
        },
      };
    }
  };
}

// ─── Handler registration helper ───

/**
 * Register a single IPC request-response channel with wrapHandler.
 * Prefer `typedHandler()` for contract-driven channels.
 * Used by non-contract handlers (acquire, etc.).
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
import { registerConceptsHandlers } from './concepts-handler';
import { registerMappingsHandlers } from './mappings-handler';
import { registerAnnotationsHandlers } from './annotations-handler';
import { registerRagHandlers } from './rag-handler';
import { registerWorkflowsHandlers } from './workflows-handler';
import { registerAgentHandlers } from './agent-handler';
import { registerArticlesHandlers } from './articles-handler';
import { registerSnapshotsHandlers } from './snapshots-handler';
import { registerAdvisoryHandlers } from './advisory-handler';
import { registerMemosHandlers } from './memos-handler';
import { registerNotesHandlers } from './notes-handler';
import { registerConceptSuggestionsHandlers } from './concept-suggestions-handler';
import { registerSettingsHandlers } from './settings-handler';
import { registerSystemHandlers } from './system-handler';
import { registerTagsHandlers } from './tags-handler';
import { registerWindowHandlers } from './window-handler';
import { registerWorkspaceHandlers } from './workspace-handler';

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
  registerConceptsHandlers(ctx);
  registerMappingsHandlers(ctx);
  registerAnnotationsHandlers(ctx);
  registerRagHandlers(ctx);
  registerWorkflowsHandlers(ctx);
  registerAgentHandlers(ctx);
  registerArticlesHandlers(ctx);
  registerSnapshotsHandlers(ctx);
  registerAdvisoryHandlers(ctx);
  registerMemosHandlers(ctx);
  registerNotesHandlers(ctx);
  registerConceptSuggestionsHandlers(ctx);
  registerSettingsHandlers(ctx);
  registerSystemHandlers(ctx);
  registerTagsHandlers(ctx);
  registerWindowHandlers(ctx);
  registerWorkspaceHandlers(ctx);

  ctx.logger.info('IPC handlers registered', { namespaces: 20 });
}
