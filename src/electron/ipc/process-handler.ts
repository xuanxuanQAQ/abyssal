/**
 * IPC handler: process namespace
 *
 * These channels are not in the IpcContract (no contract-defined channels).
 * Kept as stubs using registerHandler for now until contract is extended.
 *
 * TODO: ProcessModule full implementation pending verification.
 */

import type { AppContext } from '../app-context';
import { registerHandler } from './register';

export function registerProcessHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  registerHandler('process:extract', logger, async (_e, paperId: unknown) => {
    if (!ctx.processModule) throw new Error('Process module not initialized');
    // TODO: delegate to processModule.extractText(paperId)
    throw new Error('Not implemented');
  });

  registerHandler('process:chunk', logger, async (_e, paperId: unknown) => {
    if (!ctx.processModule) throw new Error('Process module not initialized');
    // TODO: delegate to processModule.chunkText(paperId)
    throw new Error('Not implemented');
  });

  registerHandler('process:analyze', logger, async (_e, paperId: unknown) => {
    if (!ctx.processModule) throw new Error('Process module not initialized');
    // TODO: delegate to processModule.analyze(paperId)
    throw new Error('Not implemented');
  });
}
