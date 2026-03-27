/**
 * IPC handler: bibliography namespace
 *
 * These channels are not in the IpcContract (no contract-defined channels).
 * Kept as stubs using registerHandler for now until contract is extended.
 *
 * TODO: enrichBibliography depends on upper-layer adapter module.
 */

import type { AppContext } from '../app-context';
import { registerHandler } from './register';

export function registerBibliographyHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  registerHandler('bibliography:format', logger, async (_e, paperId: unknown, style?: unknown) => {
    if (!ctx.bibliographyModule) throw new Error('Bibliography service not initialized');
    // TODO: delegate to bibliographyModule.formatCitation(paperId, style)
    return '';
  });

  registerHandler('bibliography:enrich', logger, async (_e, paperId: unknown) => {
    if (!ctx.bibliographyModule) throw new Error('Bibliography service not initialized');
    // TODO: enrichBibliography requires network requests
    throw new Error('Not implemented');
  }, { timeoutMs: 60_000 });

  registerHandler('bibliography:validate', logger, async (_e, paperId: unknown) => {
    if (!ctx.bibliographyModule) throw new Error('Bibliography service not initialized');
    return { valid: true, issues: [] };
  });
}
