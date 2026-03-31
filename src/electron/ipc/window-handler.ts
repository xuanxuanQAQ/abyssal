/**
 * IPC handler: window namespace
 *
 * Contract channels: app:window:minimize, app:window:toggleMaximize,
 *                    app:window:close, app:window:popOut, app:window:list
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerWindowHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('app:window:minimize', logger, async () => {
    ctx.mainWindow?.minimize();
  });

  typedHandler('app:window:toggleMaximize', logger, async () => {
    const win = ctx.mainWindow;
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });

  typedHandler('app:window:close', logger, async () => {
    ctx.mainWindow?.close();
  });

  typedHandler('app:window:popOut', logger, async () => {
    throw new Error('Multi-window not supported');
  });

  typedHandler('app:window:list', logger, async () => []);
}
