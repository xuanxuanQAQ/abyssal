/**
 * Lifecycle management — graceful shutdown and emergency crash handling.
 *
 * Seven-step graceful shutdown:
 *   1. Mark shutting down
 *   2. Check/abort active workflows
 *   3. Terminate Worker Thread
 *   4. WAL TRUNCATE checkpoint
 *   5. Close database connection
 *   6. Release process lock
 *   7. Flush logger
 *
 * See spec: section 8 — Graceful Exit
 */

import { app, dialog, type BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppContext } from './app-context';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Graceful shutdown — called from `before-quit` or `window-all-closed`.
 *
 * Returns false if user cancels (active workflows prompt).
 */
export async function gracefulShutdown(
  ctx: AppContext,
  mainWindow: BrowserWindow | null,
): Promise<boolean> {
  // Step 1: Mark shutting down
  if (ctx.isShuttingDown) return true;
  ctx.isShuttingDown = true;

  // Step 2: Check active workflows
  const activeCount = ctx.activeWorkflows.size;
  if (activeCount > 0 && mainWindow && !mainWindow.isDestroyed()) {
    const userChoice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      message: `${activeCount} workflow(s) still running. Quit anyway?`,
      buttons: ['Cancel', 'Force Quit'],
      defaultId: 0,
      cancelId: 0,
    });

    if (userChoice === 0) {
      // User cancelled
      ctx.isShuttingDown = false;
      return false;
    }

    // Abort all active workflows
    for (const [, workflow] of ctx.activeWorkflows) {
      workflow.abortController.abort();
    }

    // Wait for workflows to clean up (max 5s)
    const completions = Array.from(ctx.activeWorkflows.values()).map(
      (w) => w.completionPromise,
    );
    await Promise.race([Promise.allSettled(completions), sleep(5000)]);
  }

  // Step 3: Terminate Worker Thread
  if (ctx.workerThread) {
    try {
      ctx.workerThread.postMessage({ type: 'shutdown' });
      await Promise.race([
        new Promise<void>((resolve) => {
          ctx.workerThread!.once('exit', () => resolve());
        }),
        sleep(5000),
      ]);
      // If still alive after 5s, force terminate
      if ((ctx.workerThread as unknown as { exitCode: number | null }).exitCode === null) {
        ctx.workerThread.terminate();
      }
    } catch {
      // Ignore Worker termination errors
    }
  }

  // Step 3.5: Shutdown DLA subprocess
  if (ctx.dlaProxy) {
    try {
      await Promise.race([ctx.dlaProxy.shutdown(), sleep(5000)]);
    } catch {
      // Ignore DLA shutdown errors
    }
  }

  // Step 3.6: Persist AI session state (WorkingMemory + conversation)
  try {
    const session = ctx.session;
    const orchestrator = ctx.sessionOrchestrator;

    if (session) {
      // Save working memory entries
      const memoryEntries = session.memory.getAll().map((e) => ({
        id: e.id,
        type: e.type,
        content: e.content,
        source: e.source,
        linked_entities: JSON.stringify(e.linkedEntities),
        importance: e.importance,
        created_at: e.createdAt,
        last_accessed_at: e.lastAccessedAt,
        tags: e.tags ? JSON.stringify(e.tags) : null,
      }));
      if (memoryEntries.length > 0) {
        await ctx.dbProxy.saveSessionMemory(memoryEntries);
        ctx.logger.info('Session memory persisted', { entries: memoryEntries.length });
      }
    }

    if (orchestrator) {
      // Save conversation history
      const conversationJson = orchestrator.serializeConversation();
      if (conversationJson) {
        await ctx.dbProxy.saveSessionConversation('workspace', conversationJson);
        ctx.logger.info('Conversation persisted');
      }
    }
  } catch (err) {
    ctx.logger.warn('Failed to persist session state', { error: (err as Error).message });
  }

  // Step 4: WAL TRUNCATE checkpoint
  try {
    await ctx.dbProxy.walCheckpoint();
  } catch {
    ctx.logger.warn('Checkpoint failed during shutdown');
  }

  // Step 5: Close database connection
  try {
    await ctx.dbProxy.close();
  } catch (err) {
    ctx.logger.warn('DB close error during shutdown', {
      error: (err as Error).message,
    });
  }

  // Step 6: Release process lock
  try {
    ctx.lockHandle?.release();
  } catch {
    // Ignore lock release errors
  }

  // Step 7: Flush logger
  ctx.logger.info('Application shut down gracefully');

  return true;
}

/**
 * Emergency shutdown — called from uncaught exception handler.
 *
 * Does NOT wait for workflows, does NOT show dialogs.
 * Synchronously writes crash log, then exits.
 */
export function emergencyShutdown(
  ctx: AppContext | null,
  workspacePath: string,
  error: Error,
): void {
  // Synchronous crash log
  try {
    const logsDir = path.join(workspacePath, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const crashLogPath = path.join(logsDir, 'crash.log');
    fs.writeFileSync(
      crashLogPath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        error: error.message,
        stack: error.stack,
        activeWorkflows: ctx
          ? Array.from(ctx.activeWorkflows.keys())
          : [],
      }),
    );
  } catch {
    // Can't even write crash log — nothing we can do
  }

  // Try to close DB (may fail if error originated in DB layer)
  try {
    ctx?.dbProxy?.close();
  } catch {
    // Ignore
  }

  // Try to release lock
  try {
    ctx?.lockHandle?.release();
  } catch {
    // Ignore
  }

  process.exit(1);
}

/**
 * Register global exception handlers.
 *
 * Call once during bootstrap Step 4 (after logger is available).
 */
export function registerGlobalErrorHandlers(
  ctx: AppContext | null,
  workspacePath: string,
  logger: { error: (msg: string, err?: Error, ctx?: Record<string, unknown>) => void },
): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', error, {
      stack: error.stack,
    });
    emergencyShutdown(ctx, workspacePath, error);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', undefined, {
      reason: String(reason),
    });
    // Don't exit — Promise rejections may come from non-critical operations
  });
}
