/**
 * Electron main process entry point.
 *
 * - Initializes core services via ServiceContainer
 * - Creates BrowserWindow for the renderer (React UI)
 * - Registers IPC handlers bridging renderer ↔ core modules
 * - Persists window state (position, size, maximized)
 */

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { registerAllIPCHandlers } from './ipc-registry';
import { initServiceContainer, shutdownServices, type ServiceContainer } from './service-container';
import { loadWindowState, saveWindowState } from './windowState';
import type { WindowState } from './windowState';
import { IPC_CHANNELS } from '../shared-types/ipc';

let mainWindow: BrowserWindow | null = null;
let services: ServiceContainer | null = null;

function createWindow(): void {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.bounds.width,
    height: windowState.bounds.height,
    x: windowState.bounds.x,
    y: windowState.bounds.y,
    minWidth: 1024,
    minHeight: 640,

    frame: false,
    titleBarOverlay: false,
    backgroundColor: '#0A0A0B',

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // ── 窗口状态持久化 ──
  function getCurrentWindowState(): WindowState {
    if (!mainWindow) return windowState;
    const isMaximized = mainWindow.isMaximized();
    const bounds = isMaximized ? windowState.bounds : mainWindow.getBounds();
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    return { bounds, isMaximized, displayId: String(display.id) };
  }

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      windowState.bounds = mainWindow.getBounds();
    }
  });
  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      windowState.bounds = mainWindow.getBounds();
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.APP_WINDOW_MAXIMIZED_EVENT, { isMaximized: true });
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.APP_WINDOW_MAXIMIZED_EVENT, { isMaximized: false });
  });

  let forceClose = false;
  mainWindow.on('close', () => {
    if (forceClose || !mainWindow) return;
    saveWindowState(getCurrentWindowState());
  });

  ipcMain.handle('app:window:forceClose', () => { forceClose = true; mainWindow?.close(); });
  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_MINIMIZE, () => { mainWindow?.minimize(); });
  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) { mainWindow.unmaximize(); return false; }
    mainWindow.maximize(); return true;
  });
  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_CLOSE, () => { mainWindow?.close(); });

  // ── 加载页面 ──
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── 启动 ───

const isBatchMode = process.argv.includes('--batch');

if (isBatchMode) {
  console.log('[Abyssal] Batch mode — not implemented yet');
  app.quit();
} else {
  app.whenReady().then(() => {
    services = initServiceContainer();
    registerAllIPCHandlers({
      db: services.dbService,
      biblio: services.biblioService,
      search: null,
      acquire: null,
      process: null,
      rag: null,
      logger: services.logger,
    });
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (services) shutdownServices(services);
    app.quit();
  });
}
