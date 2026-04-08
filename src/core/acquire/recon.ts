// ═══ Layer 1: Recon — 并行侦察引擎 ═══
// 在任何下载尝试之前，并行收集论文的出版商、OA 状态、备选下载源。
// 使用 Promise.allSettled：任何单源失败不阻塞其他源。

import type { HttpClient } from '../infra/http-client';
import type { RateLimiter } from '../infra/rate-limiter';
import type { Logger } from '../infra/logger';
import { ReconCache, type CachedRecon } from './recon-cache';

// ─── Types ───

export interface OpenAlexData {
  isOa: boolean;
  oaStatus: 'gold' | 'green' | 'hybrid' | 'bronze' | 'closed' | null;
  pdfUrls: string[];
  repositoryUrls: string[];
  landingPageUrls: string[];
}

export interface CrossRefData {
  pdfLinks: string[];
  licenseUrl: string | null;
}

export interface ReconAttempt {
  source: 'cache' | 'doi-head' | 'openalex' | 'crossref';
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  durationMs: number;
  failureReason: string | null;
}

export interface ReconResult {
  publisherDomain: string | null;
  resolvedUrl: string | null;
  openAlexData: OpenAlexData | null;
  crossRefData: CrossRefData | null;
  fromCache: boolean;
  reconAt: string;
  reconAttempts: ReconAttempt[];
}

export interface RunReconParams {
  doi: string | null;
  http: HttpClient;
  /** 可选：用于 DOI HEAD 重定向的代理 HttpClient（访问出版商网站可能需要代理） */
  proxyHttp?: HttpClient | undefined;
  openAlexLimiter: RateLimiter;
  crossRefLimiter: RateLimiter;
  openAlexEmail: string | null;
  cache: ReconCache | null;
  reconCacheTtlDays: number;
  oaCacheRefreshDays: number;
  perSourceTimeoutMs: number;
  logger: Logger;
}

// ─── DOI HEAD Redirect ───

async function reconDoiHead(
  http: HttpClient,
  doi: string,
  timeoutMs: number,
  logger: Logger,
): Promise<{ publisherDomain: string | null; resolvedUrl: string | null }> {
  // doi.org does content negotiation:
  //   Accept: application/json → redirects to CrossRef API (wrong!)
  //   Accept: text/html        → redirects to publisher landing page (correct)
  //
  // Strategy: HEAD first (fast, no body download), fallback to GET if HEAD fails.
  // Some DOI resolvers / publishers return 405 for HEAD, so GET is the safety net.

  const commonHeaders = {
    Accept: 'text/html,application/xhtml+xml,*/*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };

  let resolvedUrl: string | null;

  // ── Attempt 1: HEAD (fast — no body transfer) ──
  try {
    const headResp = await http.request(`https://doi.org/${doi}`, {
      method: 'HEAD',
      timeoutMs: Math.min(timeoutMs, 6000), // HEAD 应该很快
      maxRedirects: 8,
      headers: commonHeaders,
    });
    resolvedUrl = headResp.url;
    logger.debug('[Recon] DOI HEAD (via HEAD) resolved', {
      doi, resolvedUrl, httpStatus: headResp.status, durationMs: headResp.durationMs,
    });
  } catch (headErr) {
    // HEAD 被拒绝（405、超时等）→ 降级到 GET
    logger.debug('[Recon] DOI HEAD method failed, falling back to GET', {
      doi, error: (headErr as Error).message,
    });
    try {
      const getResp = await http.request(`https://doi.org/${doi}`, {
        method: 'GET',
        timeoutMs,
        maxRedirects: 8,
        headers: commonHeaders,
      });
      resolvedUrl = getResp.url;
      logger.debug('[Recon] DOI HEAD (via GET fallback) resolved', {
        doi, resolvedUrl, httpStatus: getResp.status, durationMs: getResp.durationMs,
      });
    } catch (getErr) {
      logger.warn('[Recon] DOI HEAD both HEAD and GET failed', {
        doi, headError: (headErr as Error).message, getError: (getErr as Error).message,
      });
      return { publisherDomain: null, resolvedUrl: null };
    }
  }

  let hostname: string | null = null;
  try {
    hostname = new URL(resolvedUrl).hostname;
  } catch {
    // URL parse failed
  }

  return { publisherDomain: hostname, resolvedUrl };
}

// ─── OpenAlex API ───

interface OpenAlexWork {
  open_access?: {
    is_oa?: boolean;
    oa_status?: string;
  };
  locations?: Array<{
    is_oa?: boolean;
    pdf_url?: string | null;
    landing_page_url?: string | null;
    source?: { type?: string } | null;
  }>;
  best_oa_location?: {
    pdf_url?: string | null;
    landing_page_url?: string | null;
  } | null;
}

async function reconOpenAlex(
  http: HttpClient,
  limiter: RateLimiter,
  doi: string,
  email: string | null,
  timeoutMs: number,
  logger: Logger,
): Promise<OpenAlexData> {
  await limiter.acquire();

  const headers: Record<string, string> = {};
  if (email) {
    headers['User-Agent'] = `Abyssal/1.0 (mailto:${email})`;
  }

  const url = `https://api.openalex.org/works/doi:${doi}`;
  const data = await http.requestJson<OpenAlexWork>(url, { timeoutMs, headers });

  const isOa = data.open_access?.is_oa ?? false;
  const oaStatus = (data.open_access?.oa_status as OpenAlexData['oaStatus']) ?? null;

  const pdfUrls: string[] = [];
  const repositoryUrls: string[] = [];
  const landingPageUrls: string[] = [];

  // best_oa_location first
  if (data.best_oa_location?.pdf_url) {
    pdfUrls.push(data.best_oa_location.pdf_url);
  }

  // All locations
  for (const loc of data.locations ?? []) {
    if (loc.pdf_url && !pdfUrls.includes(loc.pdf_url)) {
      if (loc.source?.type === 'repository') {
        repositoryUrls.push(loc.pdf_url);
      } else {
        pdfUrls.push(loc.pdf_url);
      }
    }
    if (loc.landing_page_url && !landingPageUrls.includes(loc.landing_page_url)) {
      landingPageUrls.push(loc.landing_page_url);
    }
  }

  logger.debug('[Recon] OpenAlex result', {
    doi, isOa, oaStatus,
    pdfUrls: pdfUrls.length, repositoryUrls: repositoryUrls.length,
    landingPageUrls: landingPageUrls.length,
    locations: (data.locations ?? []).length,
  });

  return { isOa, oaStatus, pdfUrls, repositoryUrls, landingPageUrls };
}

// ─── CrossRef API ───

interface CrossRefWork {
  message?: {
    link?: Array<{
      URL?: string;
      'content-type'?: string;
      'intended-application'?: string;
    }>;
    license?: Array<{
      URL?: string;
    }>;
  };
}

async function reconCrossRef(
  http: HttpClient,
  limiter: RateLimiter,
  doi: string,
  timeoutMs: number,
  logger: Logger,
): Promise<CrossRefData> {
  await limiter.acquire();

  const encodedDoi = doi.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.crossref.org/works/${encodedDoi}`;
  const data = await http.requestJson<CrossRefWork>(url, { timeoutMs });

  const allLinks = data.message?.link ?? [];
  const pdfLinks = allLinks
    .filter((l) => l['content-type']?.includes('application/pdf') && l.URL)
    .map((l) => l.URL!);

  const licenseUrl = data.message?.license?.[0]?.URL ?? null;

  logger.debug('[Recon] CrossRef result', {
    doi, pdfLinks: pdfLinks.length, licenseUrl,
    allLinkTypes: allLinks.map((l) => l['content-type']).join(', ') || '(none)',
  });

  return { pdfLinks, licenseUrl };
}

// ─── Main Recon ───

/**
 * Layer 1: 并行侦察。
 *
 * 无 DOI 时直接返回空结果。
 * 有缓存且未过期时直接返回缓存（OA 过期时仅刷新 OA 部分）。
 * 否则并行执行 DOI HEAD + OpenAlex + CrossRef。
 */
export async function runRecon(params: RunReconParams): Promise<ReconResult> {
  const {
    doi, http, proxyHttp, openAlexLimiter, crossRefLimiter, openAlexEmail,
    cache, reconCacheTtlDays, oaCacheRefreshDays,
    perSourceTimeoutMs, logger,
  } = params;
  const doiHeadHttp = proxyHttp ?? http; // DOI HEAD 优先走代理（出版商网站可能需要）

  const reconAttempts: ReconAttempt[] = [];
  const reconAt = new Date().toISOString();

  // 无 DOI → 空结果
  if (!doi) {
    return {
      publisherDomain: null, resolvedUrl: null,
      openAlexData: null, crossRefData: null,
      fromCache: false, reconAt, reconAttempts,
    };
  }

  // ── 缓存查询 ──
  if (cache) {
    const cacheStart = Date.now();
    const { cached, oaExpired } = await cache.get(doi, reconCacheTtlDays, oaCacheRefreshDays);
    if (cached && !oaExpired) {
      reconAttempts.push({
        source: 'cache', status: 'success',
        durationMs: Date.now() - cacheStart, failureReason: null,
      });
      logger.debug('[Recon] Full cache hit', { doi });
      return cachedToResult(cached, reconAttempts);
    }
    // oaExpired: 稳定数据可用，但需刷新 OA → 只跑 OpenAlex
    if (cached && oaExpired) {
      reconAttempts.push({
        source: 'cache', status: 'success',
        durationMs: Date.now() - cacheStart, failureReason: 'OA data expired, refreshing',
      });
      logger.debug('[Recon] Partial cache hit (OA expired), refreshing OpenAlex', { doi });

      const oaStart = Date.now();
      try {
        const oaData = await reconOpenAlex(http, openAlexLimiter, doi, openAlexEmail, perSourceTimeoutMs, logger);
        reconAttempts.push({ source: 'openalex', status: 'success', durationMs: Date.now() - oaStart, failureReason: null });

        const result = cachedToResult(cached, reconAttempts);
        result.openAlexData = oaData;
        result.fromCache = false; // 有刷新
        result.reconAt = reconAt;

        // 更新缓存
        await cache.set(resultToCached(doi, result));
        return result;
      } catch (err) {
        reconAttempts.push({
          source: 'openalex', status: 'failed',
          durationMs: Date.now() - oaStart,
          failureReason: (err as Error).message,
        });
        // OA 刷新失败，用旧数据
        return cachedToResult(cached, reconAttempts);
      }
    }
  }

  // ── 全量并行侦察 ──
  logger.info('[Recon] Running full recon', { doi });

  const tasks = await Promise.allSettled([
    timedTask('doi-head', () => reconDoiHead(doiHeadHttp, doi, perSourceTimeoutMs, logger)),
    timedTask('openalex', () => reconOpenAlex(http, openAlexLimiter, doi, openAlexEmail, perSourceTimeoutMs, logger)),
    timedTask('crossref', () => reconCrossRef(http, crossRefLimiter, doi, perSourceTimeoutMs, logger)),
  ]);

  let publisherDomain: string | null = null;
  let resolvedUrl: string | null = null;
  let openAlexData: OpenAlexData | null = null;
  let crossRefData: CrossRefData | null = null;

  // DOI HEAD
  const doiTask = tasks[0]!;
  if (doiTask.status === 'fulfilled') {
    publisherDomain = doiTask.value.result.publisherDomain;
    resolvedUrl = doiTask.value.result.resolvedUrl;
    reconAttempts.push({ source: 'doi-head', status: 'success', durationMs: doiTask.value.durationMs, failureReason: null });
  } else {
    reconAttempts.push({ source: 'doi-head', status: 'failed', durationMs: 0, failureReason: doiTask.reason?.message ?? 'Unknown' });
  }

  // OpenAlex
  const oaTask = tasks[1]!;
  if (oaTask.status === 'fulfilled') {
    openAlexData = oaTask.value.result;
    reconAttempts.push({ source: 'openalex', status: 'success', durationMs: oaTask.value.durationMs, failureReason: null });
  } else {
    reconAttempts.push({ source: 'openalex', status: 'failed', durationMs: 0, failureReason: oaTask.reason?.message ?? 'Unknown' });
  }

  // CrossRef
  const crTask = tasks[2]!;
  if (crTask.status === 'fulfilled') {
    crossRefData = crTask.value.result;
    reconAttempts.push({ source: 'crossref', status: 'success', durationMs: crTask.value.durationMs, failureReason: null });
  } else {
    reconAttempts.push({ source: 'crossref', status: 'failed', durationMs: 0, failureReason: crTask.reason?.message ?? 'Unknown' });
  }

  const result: ReconResult = {
    publisherDomain, resolvedUrl, openAlexData, crossRefData,
    fromCache: false, reconAt, reconAttempts,
  };

  // ── 写入缓存 ──
  if (cache) {
    await cache.set(resultToCached(doi, result));
  }

  logger.info('[Recon] Complete', {
    doi,
    publisherDomain,
    isOa: openAlexData?.isOa ?? null,
    oaPdfUrls: openAlexData?.pdfUrls.length ?? 0,
    crossRefPdfLinks: crossRefData?.pdfLinks.length ?? 0,
    attempts: reconAttempts.map((a) => `${a.source}:${a.status}`).join(', '),
  });

  return result;
}

// ─── Helpers ───

async function timedTask<T>(
  _name: string,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

function cachedToResult(cached: CachedRecon, reconAttempts: ReconAttempt[]): ReconResult {
  const oaStatus = cached.oaStatus as OpenAlexData['oaStatus'] ?? null;
  return {
    publisherDomain: cached.publisherDomain,
    resolvedUrl: cached.resolvedUrl,
    openAlexData: {
      isOa: oaStatus !== null && oaStatus !== 'closed',
      oaStatus,
      pdfUrls: cached.pdfUrls,
      repositoryUrls: cached.repositoryUrls,
      landingPageUrls: cached.landingPageUrls,
    },
    crossRefData: {
      pdfLinks: cached.crossrefPdfLinks,
      licenseUrl: cached.licenseUrl,
    },
    fromCache: true,
    reconAt: cached.reconAt,
    reconAttempts,
  };
}

function resultToCached(doi: string, result: ReconResult): CachedRecon {
  return {
    doi,
    publisherDomain: result.publisherDomain,
    resolvedUrl: result.resolvedUrl,
    oaStatus: result.openAlexData?.oaStatus ?? null,
    pdfUrls: result.openAlexData?.pdfUrls ?? [],
    repositoryUrls: result.openAlexData?.repositoryUrls ?? [],
    landingPageUrls: result.openAlexData?.landingPageUrls ?? [],
    crossrefPdfLinks: result.crossRefData?.pdfLinks ?? [],
    licenseUrl: result.crossRefData?.licenseUrl ?? null,
    reconAt: result.reconAt,
  };
}
