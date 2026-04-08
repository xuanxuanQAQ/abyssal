/**
 * WindowManager — BrowserWindow creation, dev/prod loading, crash recovery, CSP.
 *
 * See spec: section 7 — Window Management
 */

import { BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'node:path';
import { loadWindowState, saveWindowState } from './windowState';
// Event channel names (from IpcEventContract)
const WINDOW_MAXIMIZED_EVENT = 'app:window:maximizedChange$event';
import type { Logger } from '../core/infra/logger';

export interface WindowManagerOptions {
  isDev: boolean;
  logger: Logger;
}

let mainWindow: BrowserWindow | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Create the main application window.
 *
 * Uses `show: false` for deferred display — caller should call
 * mainWindow.show() after did-finish-load (bootstrap Step 11).
 */
export function createMainWindow(opts: WindowManagerOptions): BrowserWindow {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.bounds.width,
    height: windowState.bounds.height,
    x: windowState.bounds.x,
    y: windowState.bounds.y,
    minWidth: 1024,
    minHeight: 680,
    show: false, // Deferred display — wait for did-finish-load

    frame: false,
    titleBarOverlay: false,
    backgroundColor: '#0A0A0B',

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  if (windowState.isMaximized) mainWindow.maximize();

  // ── Window state persistence (500ms debounce) ──

  const debounceSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const isMaximized = mainWindow.isMaximized();
      const bounds = isMaximized ? windowState.bounds : mainWindow.getBounds();
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      saveWindowState({
        bounds,
        isMaximized,
        displayId: String(display.id),
      });
    }, 500);
  };

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      windowState.bounds = mainWindow.getBounds();
    }
    debounceSave();
  });

  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      windowState.bounds = mainWindow.getBounds();
    }
    debounceSave();
  });

  // ── Maximized state events (push to renderer) ──

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(WINDOW_MAXIMIZED_EVENT, {
      isMaximized: true,
    });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(WINDOW_MAXIMIZED_EVENT, {
      isMaximized: false,
    });
  });

  // Window control IPC handlers are registered in system-handler.ts via typedHandler

  ipcMain.handle('app:window:forceClose', () => {
    mainWindow?.destroy();
  });

  // ── Renderer crash recovery (with loop protection) ──

  const CRASH_WINDOW_MS = 30_000; // 30 second sliding window
  const MAX_CRASHES_IN_WINDOW = 3;
  const crashTimestamps: number[] = [];

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    opts.logger.error('Renderer crashed', undefined, {
      reason: details.reason,
      exitCode: details.exitCode,
    });

    if (details.reason === 'oom') {
      opts.logger.warn('Renderer OOM — consider reducing mmap_size');
    }

    // Track crash frequency to detect crash loops
    const now = Date.now();
    crashTimestamps.push(now);
    // Evict timestamps outside the sliding window
    while (crashTimestamps.length > 0 && crashTimestamps[0]! < now - CRASH_WINDOW_MS) {
      crashTimestamps.shift();
    }

    if (crashTimestamps.length >= MAX_CRASHES_IN_WINDOW) {
      // Crash loop detected — load a safe recovery page instead of the app
      opts.logger.error('Crash loop detected — loading recovery page', undefined, {
        crashCount: crashTimestamps.length,
        windowMs: CRASH_WINDOW_MS,
      });
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          loadCrashRecoveryPage(mainWindow, details.reason);
        }
      }, 500);
    } else {
      // Isolated crash — reload normally after 1s delay
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          loadContent(mainWindow, opts.isDev, opts.logger);
        }
      }, 1000);
    }
  });

  // ── CSP headers ──

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      const csp = opts.isDev
        ? "default-src 'self' http://localhost:5173; script-src 'self' 'unsafe-inline' http://localhost:5173; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http://localhost:5173; connect-src 'self' ws://localhost:5173 http://localhost:5173; worker-src 'self' blob:;"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; worker-src 'self' blob:;";
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    },
  );

  // ── Load content (dev or prod) ──

  loadContent(mainWindow, opts.isDev, opts.logger);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Load content into the window — dev server URL or production file.
 */
function loadContent(
  window: BrowserWindow,
  isDev: boolean,
  logger: Logger,
): void {
  if (isDev) {
    let retryCount = 0;
    const maxRetries = 3;

    const tryLoad = () => {
      window.loadURL('http://localhost:5173').catch(() => {
        retryCount++;
        if (retryCount < maxRetries) {
          logger.warn(`Vite dev server not ready, retrying (${retryCount}/${maxRetries})...`);
          setTimeout(tryLoad, 2000);
        } else {
          logger.error('Vite dev server not reachable after retries. Run: npm run dev:renderer');
        }
      });
    };
    tryLoad();

    window.webContents.openDevTools({ mode: 'right' });
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Load a safe crash recovery page when a crash loop is detected.
 *
 * Renders an inline HTML page (no external dependencies) with:
 * - Crash reason explanation
 * - "Reload App" button (retries normal load)
 * - "Reset UI State" button (clears window-state.json then reloads)
 */
function loadCrashRecoveryPage(window: BrowserWindow, reason: string): void {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { background: #0A0A0B; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; max-width: 480px; padding: 40px; }
  h1 { font-size: 24px; margin-bottom: 12px; color: #fff; }
  p { font-size: 14px; line-height: 1.6; color: #999; margin-bottom: 24px; }
  .reason { background: #1a1a1d; padding: 8px 16px; border-radius: 6px; font-family: monospace;
            font-size: 13px; color: #ff6b6b; margin-bottom: 24px; display: inline-block; }
  button { padding: 10px 24px; border-radius: 6px; border: none; cursor: pointer;
           font-size: 14px; margin: 0 8px; transition: opacity 0.2s; }
  button:hover { opacity: 0.85; }
  .primary { background: #3b82f6; color: #fff; }
  .secondary { background: #2a2a2d; color: #ccc; }
</style></head><body>
<div class="card">
  <h1>Renderer Crashed</h1>
  <div class="reason">${reason}</div>
  <p>The renderer process crashed repeatedly. This may be caused by a view that
  consumes too much memory. You can reload the app or reset the UI state to
  return to a safe initial view.</p>
  <button class="primary" onclick="location.reload()">Reload App</button>
  <button class="secondary" onclick="fetch('abyssal://reset-ui').then(()=>location.reload())">Reset UI State</button>
</div></body></html>`;

  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

/**
 * Get the current main window reference.
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
