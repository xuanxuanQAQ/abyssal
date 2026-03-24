/**
 * Electron main process entry point.
 *
 * - Creates BrowserWindow for the renderer (React UI)
 * - Registers IPC handlers bridging renderer ↔ core modules
 * - Persists window state (position, size, maximized)
 * - In --batch mode: runs Orchestrator headlessly and exits
 */

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { registerAllIPCHandlers } from './ipc-registry';
import { loadWindowState, saveWindowState } from './windowState';
import type { WindowState } from './windowState';
import { IPC_CHANNELS } from '../shared-types/ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    // §1.1 窗口尺寸
    width: windowState.bounds.width,
    height: windowState.bounds.height,
    x: windowState.bounds.x,
    y: windowState.bounds.y,
    minWidth: 1024,
    minHeight: 640,

    // §1.1 无边框窗口（自绘 TitleBar）
    frame: false,
    titleBarOverlay: false,
    backgroundColor: '#0A0A0B',

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },

    // TODO: 设置应用图标
    // icon: path.join(__dirname, '../../build/icon.png'),
  });

  // 恢复最大化状态
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // ── 窗口状态持久化 ──────────────────────────────
  // §1.2 关闭前保存 bounds、最大化状态、displayId

  function getCurrentWindowState(): WindowState {
    if (!mainWindow) return windowState;
    const isMaximized = mainWindow.isMaximized();
    // 最大化时记录还原后的 bounds，避免保存全屏尺寸
    const bounds = isMaximized
      ? windowState.bounds
      : mainWindow.getBounds();
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    return {
      bounds,
      isMaximized,
      displayId: String(display.id),
    };
  }

  // 非最大化时持续跟踪 bounds
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

  // ── 最大化状态变更事件 ──────────────────────────
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(
      IPC_CHANNELS.APP_WINDOW_MAXIMIZED_EVENT,
      { isMaximized: true }
    );
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(
      IPC_CHANNELS.APP_WINDOW_MAXIMIZED_EVENT,
      { isMaximized: false }
    );
  });

  // ── §13 窗口关闭拦截 ──────────────────────────
  // 主进程通过 IPC 询问渲染进程是否允许关闭
  let forceClose = false;

  mainWindow.on('close', (_event) => {
    if (forceClose || !mainWindow) return;

    // 保存窗口状态
    saveWindowState(getCurrentWindowState());

    // TODO: 通过 IPC 询问渲染进程是否允许关闭
    // 目前先直接允许关闭
    // event.preventDefault();
    // mainWindow.webContents.send('app:window:closeRequested');
  });

  // 提供强制关闭入口（渲染进程确认后调用）
  ipcMain.handle('app:window:forceClose', () => {
    forceClose = true;
    mainWindow?.close();
  });

  // ── 窗口控制 IPC ──────────────────────────────
  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_MINIMIZE, () => {
    mainWindow?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow.maximize();
      return true;
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_CLOSE, () => {
    mainWindow?.close();
  });

  // ── 加载页面 ──────────────────────────────────
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 批处理模式检测
const isBatchMode = process.argv.includes('--batch');

if (isBatchMode) {
  // TODO: 接入 src/cli/batch.ts 的无头批处理流程
  console.log('[Abyssal] Batch mode — not implemented yet');
  app.quit();
} else {
  app.whenReady().then(() => {
    registerAllIPCHandlers();
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
