/**
 * Electron main process entry point.
 *
 * Two responsibilities:
 * 1. Detect --batch mode → CLI entry (no GUI).
 * 2. app.whenReady() → bootstrap() → 11-step startup sequence.
 *
 * All initialization logic lives in bootstrap.ts.
 * All window management lives in window-manager.ts.
 * All IPC handlers live in ipc/*.ts.
 * All lifecycle management lives in lifecycle.ts.
 *
 * See spec: section 1.1 — Entry: main.ts
 */

import { app } from 'electron';
import { bootstrap } from './bootstrap';
import { gracefulShutdown } from './lifecycle';
import type { AppContext } from './app-context';

// ─── Batch mode detection ───

const isBatchMode = process.argv.includes('--batch');

if (isBatchMode) {
  // Batch mode: skip GUI, run Orchestrator + workflows headlessly.
  import('../cli/cli-entry').then(({ parseCliArgs }) => {
    const cliArgs = parseCliArgs(process.argv);
    import('../cli/batch-runner').then(({ batchRun }) => {
      batchRun(cliArgs).then(() => {
        app.quit();
      }).catch((err) => {
        process.stderr.write(`Fatal: ${(err as Error).message}\n`);
        app.quit();
      });
    });
  });
} else {
  // ─── GUI mode ───

  let appContext: AppContext | null = null;

  app.whenReady().then(async () => {
    appContext = await bootstrap();
  });

  app.on('window-all-closed', async () => {
    if (appContext) {
      const shouldQuit = await gracefulShutdown(appContext, appContext.mainWindow);
      if (shouldQuit) app.quit();
    } else {
      app.quit();
    }
  });

  app.on('before-quit', async (event) => {
    if (appContext && !appContext.isShuttingDown) {
      event.preventDefault();
      const shouldQuit = await gracefulShutdown(appContext, appContext.mainWindow);
      if (shouldQuit) app.quit();
    }
  });
}
