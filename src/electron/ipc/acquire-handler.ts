/**
 * IPC handler: acquire namespace
 *
 * These channels are not in the IpcContract (no contract-defined channels).
 * Kept as stubs using registerHandler for now until contract is extended.
 *
 * TODO: AcquireModule full implementation pending verification.
 */

import type { AppContext } from '../app-context';
import { registerHandler } from './register';

export function registerAcquireHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  registerHandler('acquire:fulltext', logger, async (_e, paperId: unknown) => {
    if (!ctx.acquireModule) throw new Error('Acquire module not initialized');
    // TODO: delegate to acquireModule.acquireFulltext(paperId)
    throw new Error('Not implemented');
  });

  registerHandler('acquire:batch', logger, async (_e, paperIds: unknown) => {
    if (!ctx.acquireModule) throw new Error('Acquire module not initialized');
    // TODO: delegate to acquireModule.acquireBatch(paperIds)
    throw new Error('Not implemented');
  });

  registerHandler('acquire:status', logger, async (_e, paperId: unknown) => {
    if (!ctx.acquireModule) throw new Error('Acquire module not initialized');
    return { status: 'not_attempted' };
  });
}
