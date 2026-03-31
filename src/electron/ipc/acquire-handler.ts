/**
 * IPC handler: acquire namespace
 *
 * Channels:
 * - acquire:fulltext  — single paper fulltext acquisition (starts workflow)
 * - acquire:batch     — batch acquisition (starts workflow for multiple papers)
 * - acquire:status    — query current fulltext status for a paper
 */

import type { AppContext } from '../app-context';
import type { PaperId } from '../../core/types/common';
import { typedHandler } from './register';
import {
  getInstitutionList,
  openInstitutionalLogin,
  resolveInstitutionName,
  LOGIN_PUBLISHERS,
} from '../institutional-login';

export function registerAcquireHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── acquire:fulltext — single paper ──
  typedHandler('acquire:fulltext', logger, async (_e, paperId) => {
    logger.info('[acquire:fulltext] IPC invoked', { paperId });

    const orchestrator = ctx.orchestrator;
    if (!orchestrator) {
      logger.error('[acquire:fulltext] Orchestrator not initialized');
      throw new Error('Orchestrator not initialized');
    }

    // Mark paper as pending immediately so UI reflects state
    try {
      await ctx.dbProxy.updatePaper(paperId as unknown as PaperId, { fulltextStatus: 'pending' } as any);
      logger.debug('[acquire:fulltext] Paper marked as pending', { paperId });
    } catch (err) {
      logger.warn('[acquire:fulltext] Failed to mark paper as pending', { paperId, error: (err as Error).message });
    }

    // Start acquire workflow for a single paper
    const state = orchestrator.start('acquire', {
      paperIds: [paperId],
      concurrency: 1,
    });

    // Log workflow completion asynchronously (fire-and-forget)
    state.completionPromise.then((result) => {
      logger.info('[acquire:fulltext] Workflow completed', {
        paperId, taskId: state.id, status: result.status,
        completed: result.progress.completedItems,
        failed: result.progress.failedItems,
        durationMs: result.durationMs,
        errors: result.progress.errors.map((e) => `${e.itemId}@${e.stage}: ${e.message}`),
      });
    }).catch((err) => {
      logger.error(`[acquire:fulltext] Workflow promise rejected: paperId=${paperId} taskId=${state.id} error=${(err as Error).message}`);
    });

    logger.info('[acquire:fulltext] Workflow launched', { paperId, taskId: state.id });
    return state.id;
  });

  // ── acquire:batch — multiple papers ──
  typedHandler('acquire:batch', logger, async (_e, paperIds) => {
    const orchestrator = ctx.orchestrator;
    if (!orchestrator) throw new Error('Orchestrator not initialized');

    // Mark papers as pending immediately
    for (const id of paperIds) {
      try {
        await ctx.dbProxy.updatePaper(id as unknown as PaperId, { fulltextStatus: 'pending' } as any);
      } catch { /* best-effort */ }
    }

    const state = orchestrator.start('acquire', {
      paperIds,
      concurrency: 5,
    });

    logger.info('Acquire batch started', { count: paperIds.length, taskId: state.id });
    return state.id;
  });

  // ── acquire:status — query status ──
  typedHandler('acquire:status', logger, async (_e, paperId) => {
    const paper = await ctx.dbProxy.getPaper(paperId as unknown as PaperId) as Record<string, unknown> | null;
    if (!paper) {
      return {
        fulltextStatus: 'not_attempted' as const,
        fulltextPath: null,
        fulltextSource: null,
        failureReason: null,
        failureCount: 0,
      };
    }

    return {
      fulltextStatus: (paper['fulltextStatus'] ?? paper['fulltext_status'] ?? 'not_attempted') as any,
      fulltextPath: (paper['fulltextPath'] ?? paper['fulltext_path'] ?? null) as string | null,
      fulltextSource: (paper['fulltextSource'] ?? paper['fulltext_source'] ?? null) as string | null,
      failureReason: (paper['failureReason'] ?? paper['failure_reason'] ?? null) as string | null,
      failureCount: (paper['failureCount'] ?? paper['failure_count'] ?? 0) as number,
    };
  });

  // ── acquire:getInstitutions — list pre-configured Chinese institutions ──
  typedHandler('acquire:getInstitutions', logger, async () => {
    return getInstitutionList();
  });

  // ── acquire:institutionalLogin — open BrowserWindow for CARSI login ──
  typedHandler('acquire:institutionalLogin', logger, async (_e, institutionId, publisher) => {
    const mainWindow = ctx.mainWindow;
    if (!mainWindow) throw new Error('Main window not available');

    const cookieJar = ctx.cookieJar;
    if (!cookieJar) throw new Error('CookieJar not initialized');

    const customIdp = ctx.config.acquire.chinaCustomIdpEntityId ?? undefined;

    logger.info('[acquire:institutionalLogin] Starting login', { institutionId, publisher });

    const result = await openInstitutionalLogin(
      mainWindow,
      institutionId,
      publisher,
      cookieJar,
      logger,
      customIdp,
    );

    logger.info('[acquire:institutionalLogin] Login result', {
      institutionId, publisher,
      success: result.success,
      cookieCount: result.cookieCount,
    });

    return result;
  }, { timeoutMs: 300_000 }); // 5 min timeout for login flow

  // ── acquire:sessionStatus — query current institutional session ──
  typedHandler('acquire:sessionStatus', logger, async () => {
    const cookieJar = ctx.cookieJar;
    if (!cookieJar) {
      return {
        loggedIn: false,
        institutionId: null,
        institutionName: null,
        lastLogin: null,
        activeDomains: [],
      };
    }

    return cookieJar.getSessionStatus(resolveInstitutionName);
  });

  // ── acquire:verifyCookies — test if cookies for a publisher are still valid ──
  typedHandler('acquire:verifyCookies', logger, async (_e, publisher) => {
    const cookieJar = ctx.cookieJar;
    if (!cookieJar) {
      return { valid: false, detail: 'CookieJar not initialized' };
    }

    const pub = LOGIN_PUBLISHERS.find((p) => p.id === publisher);
    if (!pub) {
      return { valid: false, detail: `Unknown publisher: ${publisher}` };
    }

    // Check if cookies exist for publisher domain
    const hasCookies = cookieJar.hasCookiesFor([pub.domain]);
    if (!hasCookies) {
      return { valid: false, detail: 'No cookies found for this publisher' };
    }

    // Optionally try a lightweight HEAD request to verify cookies work
    try {
      const { HttpClient } = await import('../../core/infra/http-client');
      const http = new HttpClient({ logger });
      const cookieHeader = cookieJar.getCookieHeader(`https://${pub.domain}/`);
      const headers: Record<string, string> = {};
      if (cookieHeader) headers['Cookie'] = cookieHeader;

      const resp = await http.request(`https://${pub.domain}/`, {
        timeoutMs: 10_000,
        headers,
      });

      // If we get 200 and no login redirect, cookies are likely valid
      const body = resp.body.slice(0, 2000).toLowerCase();
      const isLoginPage = body.includes('sign in') || body.includes('log in') || body.includes('login');
      if (resp.status === 200 && !isLoginPage) {
        return { valid: true, detail: `Cookies valid (HTTP ${resp.status})` };
      }
      return { valid: false, detail: `Session expired — publisher returned login page` };
    } catch (err) {
      // Network error doesn't mean cookies are invalid
      return { valid: true, detail: `Cookies present, but verification request failed: ${(err as Error).message}` };
    }
  });

  // ── acquire:clearSession — clear institutional cookies ──
  typedHandler('acquire:clearSession', logger, async () => {
    const cookieJar = ctx.cookieJar;
    if (cookieJar) {
      cookieJar.clear();
      logger.info('[acquire:clearSession] Session cleared');
    }
  });
}
