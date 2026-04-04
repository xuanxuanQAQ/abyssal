// ═══ Acquire Module v2 — 4 层智能全文获取引擎 ═══
// Layer -1: Identifier Resolution（标题 → DOI/arXiv/PMCID 模糊匹配）
// Layer 0: Fast Path（零 HTTP 确定性 OA）
// Layer 1: Recon（并行侦察：DOI HEAD + OpenAlex + CrossRef）
// Layer 2: Strategy（评分排序 + EZProxy 变异 + Cookie 注入）
// Layer 3: Speculative Execution（Promise.any 投机并行 + 顺序兜底）

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AcquireResult, AcquireAttempt } from './types';
import type { AbyssalConfig } from '../types/config';
import type { Logger } from '../infra/logger';
import { HttpClient, computeSha256 } from '../infra/http-client';
import { createRateLimiter, RateLimiter } from '../infra/rate-limiter';
import { validatePdf } from './pdf-validator';
import { downloadPdf, deleteFileIfExists } from './downloader';
import { makeAttempt, withRetry, type RetryConfig } from './attempt-utils';
import { ContentSanityChecker, type LlmCallFn, type SanityCheckInput } from './content-sanity-checker';
import { IdentifierResolver } from './identifier-resolver';
import type { CookieJar } from '../infra/cookie-jar';
import type { FailureMemory, AcquireFailureType } from './failure-memory';
import { extractDoiPrefix } from './failure-memory';
import { ReconCache } from './recon-cache';

// Pipeline v2 imports
import { tryFastPath, resolveZenodoPdfUrl } from './fast-path';
import { runRecon, type ReconResult } from './recon';
import { buildStrategy, type DownloadCandidate } from './strategy';
import { speculativeExecute } from './speculative-executor';

// Legacy source imports (Phase B fallback)
import { tryUnpaywall } from './sources/unpaywall';
import { tryPmc } from './sources/pmc';
import { tryScihub } from './sources/scihub';
import { tryCnki } from './sources/cnki';
import { tryWanfang } from './sources/wanfang';

// ─── 类型重导出 ───

export type { FailureCategory, AcquireAttempt, AcquireResult, PdfValidation } from './types';
export { validatePdf } from './pdf-validator';
export { downloadPdf, computeSha256, deleteFileIfExists } from './downloader';

// ─── BrowserWindow 搜索回调类型 ───

export interface BrowserSearchResult {
  title: string;
  downloadUrl: string | null;
  detailUrl: string;
  metadata: Record<string, string>;
}

export type BrowserSearchFn = (
  source: 'cnki' | 'wanfang',
  title: string,
  options?: { authors?: string[]; year?: number | null },
) => Promise<BrowserSearchResult[]>;

// ─── 输入参数 ───

/** 数据源尝试进度回调 */
export type SourceAttemptCallback = (
  source: string,
  phase: 'start' | 'end',
  result?: { status: string; failureReason?: string | null },
) => void;

export interface AcquireFulltextParams {
  doi: string | null;
  arxivId: string | null;
  pmcid: string | null;
  url: string | null;
  savePath: string;
  enabledSources?: string[] | undefined;
  sourceOrdering?: string[] | undefined;
  perSourceTimeoutMs?: number | undefined;
  paperTitle?: string | undefined;
  paperAuthors?: string[] | undefined;
  paperYear?: number | null | undefined;
  onSourceAttempt?: SourceAttemptCallback | undefined;
}

// ═══ AcquireService ═══

export class AcquireService {
  /** 主 HttpClient（proxyMode='all' 时走代理，否则直连） */
  private readonly http: HttpClient;
  /** 代理 HttpClient（用于被封锁源：Sci-Hub、DOI HEAD 等） */
  private readonly proxyHttp: HttpClient;
  private readonly logger: Logger;
  private config: AbyssalConfig;
  private readonly unpaywallLimiter: RateLimiter;
  private readonly pmcLimiter: RateLimiter;
  private readonly openAlexLimiter: RateLimiter;
  private readonly crossRefLimiter: RateLimiter;
  private readonly sanityChecker: ContentSanityChecker | null;
  private readonly identifierResolver: IdentifierResolver | null;
  private cookieJar: CookieJar | null = null;
  private failureMemory: FailureMemory | null = null;
  private reconCache: ReconCache | null = null;
  private browserSearchFn: BrowserSearchFn | null = null;

  setCookieJar(jar: CookieJar): void {
    this.cookieJar = jar;
  }

  setFailureMemory(fm: FailureMemory): void {
    this.failureMemory = fm;
  }

  setReconCache(cache: ReconCache): void {
    this.reconCache = cache;
  }

  /** Inject BrowserWindow-based search for CNKI/Wanfang (provided by electron layer). */
  setBrowserSearch(fn: BrowserSearchFn): void {
    this.browserSearchFn = fn;
  }

  /** Allow runtime config updates (e.g. when user toggles enableCnki in settings). */
  updateConfig(config: AbyssalConfig): void {
    this.config = config;
  }

  constructor(config: AbyssalConfig, logger: Logger, llmCallFn?: LlmCallFn | null) {
    this.config = config;
    this.logger = logger;

    const acq = config.acquire;
    const proxyUrl = acq.proxyEnabled ? acq.proxyUrl : null;

    if (acq.proxyMode === 'all' && proxyUrl) {
      // 全部请求走代理
      this.http = new HttpClient({ logger, userAgentEmail: config.apiKeys.openalexEmail ?? undefined, proxyUrl });
      this.proxyHttp = this.http;
    } else if (proxyUrl) {
      // blocked-only: 主 http 直连，proxyHttp 走代理
      this.http = new HttpClient({ logger, userAgentEmail: config.apiKeys.openalexEmail ?? undefined });
      this.proxyHttp = new HttpClient({ logger, userAgentEmail: config.apiKeys.openalexEmail ?? undefined, proxyUrl });
    } else {
      // 无代理
      this.http = new HttpClient({ logger, userAgentEmail: config.apiKeys.openalexEmail ?? undefined });
      this.proxyHttp = this.http;
    }
    this.unpaywallLimiter = createRateLimiter('unpaywall');
    this.pmcLimiter = new RateLimiter(3, 3 / 1000);
    this.openAlexLimiter = new RateLimiter(10, 10 / 1000); // OpenAlex polite pool: 10 req/s
    this.crossRefLimiter = createRateLimiter('crossRef');
    const s2Limiter = new RateLimiter(5, 5 / 1000);

    this.sanityChecker = config.acquire.enableContentSanityCheck
      ? new ContentSanityChecker(llmCallFn ?? null, logger)
      : null;

    this.identifierResolver = config.acquire.enableFuzzyResolve
      ? new IdentifierResolver(
          this.http,
          this.crossRefLimiter,
          s2Limiter,
          config.apiKeys.semanticScholarApiKey ?? null,
          llmCallFn ?? null,
          logger,
        )
      : null;
  }

  /**
   * 4 层智能全文获取。
   *
   * 幂等性：savePath 已存在有效 PDF 时直接返回 success。
   * 当 enableRecon=false && enableSpeculativeExecution=false 时退化为传统瀑布流。
   */
  async acquireFulltext(params: AcquireFulltextParams): Promise<AcquireResult> {
    let {
      doi, arxivId, pmcid,
    } = params;
    const {
      savePath,
      perSourceTimeoutMs = this.config.acquire.perSourceTimeoutMs,
    } = params;
    const acqConfig = this.config.acquire;
    const notify = params.onSourceAttempt;
    const attempts: AcquireAttempt[] = [];
    const tempPath = savePath + '.tmp';
    const pipelineStartTime = Date.now();

    this.logger.info('[Acquire] Pipeline v2 start', {
      doi, arxivId, pmcid, savePath,
      paperTitle: params.paperTitle?.slice(0, 40) ?? null,
      fastPath: acqConfig.enableFastPath,
      recon: acqConfig.enableRecon,
      speculative: acqConfig.enableSpeculativeExecution,
      enableCnki: acqConfig.enableCnki,
      enableWanfang: acqConfig.enableWanfang,
    });

    // ═══ 标识符检查 ═══
    const hasTitleSources = acqConfig.enableCnki || acqConfig.enableWanfang;
    if (!doi && !arxivId && !pmcid && !params.url) {
      if (!params.paperTitle || !hasTitleSources) {
        this.logger.warn('[Acquire] No identifiers available (DOI/arXiv/PMCID/URL), cannot acquire');
        return {
          status: 'failed',
          pdfPath: null,
          source: null,
          sha256: null,
          fileSize: null,
          attempts: [makeAttempt('pipeline', 'skipped', 0, {
            failureReason: hasTitleSources
              ? 'No identifiers and no paper title available'
              : 'No identifiers available (DOI, arXiv ID, PMCID, or URL). Enable CNKI/Wanfang for title-based search.',
            failureCategory: 'no_identifier',
          })],
        };
      }
      // 有标题 + 启用了 CNKI/Wanfang → 跳过 Layer 0-2, 直接进入 Layer 3b
      this.logger.info('[Acquire] No DOI/arXiv/PMCID but title available, will try CNKI/Wanfang title search', {
        title: params.paperTitle.slice(0, 60),
        cnkiEnabled: acqConfig.enableCnki,
        wanfangEnabled: acqConfig.enableWanfang,
        hasCookieJar: !!this.cookieJar,
        cnkiCookies: this.cookieJar?.hasCookiesFor(['cnki.net', 'cnki.com.cn', 'kns.cnki.net']) ?? false,
        wanfangCookies: this.cookieJar?.hasCookiesFor(['wanfangdata.com.cn']) ?? false,
      });
    }

    // ═══ Layer -1: Identifier Resolution ═══
    // 当只有标题没有 DOI/arXiv/PMCID 时，尝试通过 CrossRef + Semantic Scholar 模糊匹配恢复标识符
    if (this.identifierResolver && !doi && !arxivId && !pmcid && params.paperTitle) {
      const resolveStart = Date.now();
      notify?.('identifier-resolve', 'start');
      try {
        const resolved = await this.identifierResolver.resolve(
          {
            title: params.paperTitle,
            authors: params.paperAuthors ?? [],
            year: params.paperYear ?? null,
          },
          acqConfig.fuzzyResolveConfidenceThreshold,
        );
        if (resolved.doi || resolved.arxivId || resolved.pmcid) {
          doi = resolved.doi ?? doi;
          arxivId = resolved.arxivId ?? arxivId;
          pmcid = resolved.pmcid ?? pmcid;
          this.logger.info('[Acquire] Layer -1 resolved identifiers from title', {
            resolvedDoi: resolved.doi,
            resolvedArxivId: resolved.arxivId,
            resolvedPmcid: resolved.pmcid,
            confidence: resolved.confidence,
            via: resolved.resolvedVia,
            candidates: resolved.candidatesFound,
            durationMs: Date.now() - resolveStart,
          });
          attempts.push(makeAttempt('identifier-resolve', 'success', Date.now() - resolveStart));
        } else {
          this.logger.debug('[Acquire] Layer -1 found no matching identifiers', {
            candidates: resolved.candidatesFound,
            confidence: resolved.confidence,
            durationMs: Date.now() - resolveStart,
          });
          attempts.push(makeAttempt('identifier-resolve', 'skipped', Date.now() - resolveStart, {
            failureReason: 'No identifiers resolved above confidence threshold',
          }));
        }
        notify?.('identifier-resolve', 'end', { status: resolved.doi ? 'success' : 'skipped' });
      } catch (err) {
        this.logger.warn('[Acquire] Layer -1 identifier resolution failed', { error: String(err) });
        attempts.push(makeAttempt('identifier-resolve', 'failed', Date.now() - resolveStart, {
          failureReason: String(err),
          failureCategory: 'unknown',
        }));
        notify?.('identifier-resolve', 'end', { status: 'failed' });
      }
    }

    // ═══ 幂等检查 ═══
    if (fs.existsSync(savePath)) {
      try {
        const validation = await validatePdf(savePath);
        if (validation.valid) {
          const sha256 = await computeSha256(savePath);
          const fileSize = fs.statSync(savePath).size;
          this.logger.debug('PDF already exists, skipping', { savePath });
          return { status: 'success', pdfPath: savePath, source: 'cached', sha256, fileSize, attempts: [] };
        }
      } catch { /* 校验失败，继续下载 */ }
    }

    // ═══ Layer 0: Fast Path ═══
    // Compute once, reuse in Layer 2 Strategy (avoids duplicate call)
    const fastPathResult = tryFastPath(doi, arxivId, pmcid);
    if (acqConfig.enableFastPath) {
      const fp = fastPathResult;
      if (fp.matched && fp.pdfUrl) {
        notify?.(fp.source ?? 'fast-path', 'start');
        this.logger.info('[Acquire] Layer 0 Fast Path HIT', { source: fp.source, url: fp.pdfUrl });

        // Zenodo 需要 API 查询拿真实 PDF URL
        let downloadUrl = fp.pdfUrl;
        let zenodoResolveFailed = false;
        if (fp.source === 'zenodo') {
          const realUrl = await resolveZenodoPdfUrl(fp.pdfUrl, this.http, perSourceTimeoutMs);
          if (!realUrl) {
            attempts.push(makeAttempt('zenodo', 'failed', 0, { failureReason: 'No PDF file in Zenodo record' }));
            notify?.('zenodo', 'end', { status: 'failed', failureReason: 'No PDF in record' });
            zenodoResolveFailed = true;
            // 继续到 Layer 1
          } else {
            downloadUrl = realUrl;
          }
        }

        if (!zenodoResolveFailed) {
          try {
            const start = Date.now();
            await downloadPdf(this.http, downloadUrl, tempPath, perSourceTimeoutMs);
            const validation = await validatePdf(tempPath);
            if (validation.valid) {
              const attempt = makeAttempt(fp.source ?? 'fast-path', 'success', Date.now() - start, { httpStatus: 200 });
              attempts.push(attempt);
              notify?.(fp.source ?? 'fast-path', 'end', { status: 'success' });
              return this.finalize(tempPath, savePath, fp.source ?? 'fast-path', attempts, params);
            }
            deleteFileIfExists(tempPath);
            attempts.push(makeAttempt(fp.source ?? 'fast-path', 'failed', Date.now() - start, {
              failureReason: validation.reason ?? 'PDF validation failed',
              failureCategory: 'invalid_pdf',
            }));
          } catch (err) {
            deleteFileIfExists(tempPath);
            const attempt = makeAttempt(fp.source ?? 'fast-path', 'failed', 0, {
              failureReason: (err as Error).message,
            });
            attempts.push(attempt);
          }
          notify?.(fp.source ?? 'fast-path', 'end', {
            status: 'failed',
            failureReason: attempts[attempts.length - 1]?.failureReason ?? null,
          });
        }
      }
    }

    // ═══ Layer 1: Recon ═══
    let recon: ReconResult | null = null;
    if (acqConfig.enableRecon && doi) {
      notify?.('recon', 'start');
      try {
        recon = await runRecon({
          doi,
          http: this.http,
          proxyHttp: this.proxyHttp,
          openAlexLimiter: this.openAlexLimiter,
          crossRefLimiter: this.crossRefLimiter,
          openAlexEmail: this.config.apiKeys.openalexEmail,
          cache: this.reconCache,
          reconCacheTtlDays: acqConfig.reconCacheTtlDays,
          oaCacheRefreshDays: acqConfig.oaCacheRefreshDays,
          perSourceTimeoutMs: acqConfig.reconTimeoutMs,
          logger: this.logger,
        });
        this.logger.info('[Acquire] Layer 1 Recon complete', {
          doi,
          fromCache: recon!.fromCache,
          publisherDomain: recon!.publisherDomain,
          resolvedUrl: recon!.resolvedUrl?.slice(0, 100),
          isOa: recon!.openAlexData?.isOa ?? null,
          oaStatus: recon!.openAlexData?.oaStatus ?? null,
          oaPdfUrls: recon!.openAlexData?.pdfUrls.length ?? 0,
          crossRefPdfLinks: recon!.crossRefData?.pdfLinks.length ?? 0,
          reconAttempts: recon!.reconAttempts.map((a) => `${a.source}:${a.status}(${a.durationMs}ms)`).join(', '),
        });
        notify?.('recon', 'end', { status: 'success' });
      } catch (err) {
        this.logger.warn('[Acquire] Recon failed (non-blocking)', { error: (err as Error).message });
        notify?.('recon', 'end', { status: 'failed', failureReason: (err as Error).message });
      }
    }

    // ═══ Layer 2: Strategy ═══
    // Reuse fastPathResult from Layer 0 (no duplicate call)
    const fastPath = fastPathResult;
    // Layer 0 成功处理过 fast-path → 不重复（matched=false）
    // Layer 0 被禁用或失败 → 保留 fast-path 候选给 Strategy/Speculative 使用
    const fastPathAlreadySucceeded = acqConfig.enableFastPath
      && attempts.some((a) => a.source === (fastPath.source ?? 'fast-path') && a.status === 'success');
    const strategy = buildStrategy({
      doi, arxivId, pmcid,
      url: params.url,
      recon,
      fastPath: fastPathAlreadySucceeded ? { ...fastPath, matched: false } : fastPath,
      cookieJar: this.cookieJar,
      failureMemory: this.failureMemory,
      config: acqConfig,
      logger: this.logger,
    });

    this.logger.info('[Acquire] Layer 2 Strategy complete', {
      simpleCandidates: strategy.simpleCandidates.length,
      complexCandidates: strategy.complexCandidates.length,
      simpleSources: strategy.simpleCandidates.map((c) => c.source),
      complexSources: strategy.complexCandidates.map((c) => c.source),
    });

    // ═══ Layer 3a: Speculative Execution (Phase A) ═══
    if (acqConfig.enableSpeculativeExecution && strategy.simpleCandidates.length > 0) {
      notify?.('speculative', 'start');
      const specResult = await speculativeExecute({
        candidates: strategy.simpleCandidates,
        baseTempPath: tempPath,
        http: this.http,
        proxyHttp: this.proxyHttp,
        maxParallel: acqConfig.maxSpeculativeParallel,
        perCandidateTimeoutMs: perSourceTimeoutMs,
        totalTimeoutMs: acqConfig.speculativeTotalTimeoutMs,
        enablePreflight: acqConfig.enablePreflight,
        preflightTimeoutMs: acqConfig.preflightTimeoutMs,
        logger: this.logger,
      });

      attempts.push(...specResult.attempts);

      this.logger.info('[Acquire] Layer 3a speculative result', {
        winner: specResult.winner?.source ?? null,
        attemptSummary: specResult.attempts.map((a) => `${a.source}:${a.status}${a.failureReason ? `(${a.failureReason.slice(0, 60)})` : ''}`).join('; '),
      });

      if (specResult.winner && specResult.pdfTempPath) {
        notify?.('speculative', 'end', { status: 'success' });
        return this.finalize(
          specResult.pdfTempPath, savePath,
          specResult.winner.source, attempts, params,
        );
      }
      notify?.('speculative', 'end', { status: 'failed' });
    } else if (!acqConfig.enableSpeculativeExecution) {
      // 降级：逐个顺序执行 simpleCandidates
      for (const candidate of strategy.simpleCandidates) {
        notify?.(candidate.source, 'start');
        try {
          const start = Date.now();
          await downloadPdf(candidate.useProxy ? this.proxyHttp : this.http, candidate.url, tempPath, perSourceTimeoutMs, candidate.headers);
          const validation = await validatePdf(tempPath);
          if (validation.valid) {
            const attempt = makeAttempt(candidate.source, 'success', Date.now() - start, { httpStatus: 200 });
            attempts.push(attempt);
            notify?.(candidate.source, 'end', { status: 'success' });
            return this.finalize(tempPath, savePath, candidate.source, attempts, params);
          }
          deleteFileIfExists(tempPath);
          attempts.push(makeAttempt(candidate.source, 'failed', Date.now() - start, {
            failureReason: validation.reason ?? 'PDF validation failed',
            failureCategory: 'invalid_pdf',
          }));
        } catch (err) {
          deleteFileIfExists(tempPath);
          attempts.push(makeAttempt(candidate.source, 'failed', 0, {
            failureReason: (err as Error).message,
          }));
        }
        notify?.(candidate.source, 'end', {
          status: 'failed',
          failureReason: attempts[attempts.length - 1]?.failureReason ?? null,
        });
      }
    }

    // ═══ Layer 3b: Phase B — 顺序兜底复杂源 ═══
    const retryConfig: RetryConfig = {
      maxRetries: acqConfig.maxRetries,
      retryDelayMs: acqConfig.retryDelayMs,
    };

    // Collect CNKI + Wanfang candidates for parallel execution below
    const cnkiWanfangCandidates: DownloadCandidate[] = [];
    const sequentialCandidates: DownloadCandidate[] = [];
    for (const candidate of strategy.complexCandidates) {
      if ((candidate.source === 'cnki' || candidate.source === 'wanfang') && params.paperTitle) {
        cnkiWanfangCandidates.push(candidate);
      } else {
        sequentialCandidates.push(candidate);
      }
    }

    // ── Sequential complex sources: PMC, Sci-Hub ──
    for (const candidate of sequentialCandidates) {
      // ── PMC ──
      if (candidate.source === 'pmc') {
        if (!pmcid && !doi) continue;
        notify?.('pmc', 'start');
        await this.pmcLimiter.acquire();
        const attempt = await withRetry('pmc', tempPath, retryConfig, () =>
          tryPmc(this.http, doi, pmcid, tempPath, perSourceTimeoutMs, acqConfig.tarMaxExtractBytes),
        );
        attempts.push(attempt);
        notify?.('pmc', 'end', { status: attempt.status, failureReason: attempt.failureReason });
        if (attempt.status === 'success') return this.finalize(tempPath, savePath, 'pmc', attempts, params);
        continue;
      }

      // ── Sci-Hub ──
      if (candidate.source === 'scihub') {
        if (!doi) continue;
        notify?.('scihub', 'start');
        const preferredDomain = acqConfig.scihubDomain ?? 'sci-hub.se';
        const attempt = await withRetry('scihub', tempPath, retryConfig, () =>
          tryScihub(
            this.proxyHttp, doi!, preferredDomain, tempPath, perSourceTimeoutMs,
            acqConfig.scihubMaxTotalMs,
          ),
        );
        attempts.push(attempt);
        notify?.('scihub', 'end', { status: attempt.status, failureReason: attempt.failureReason });
        if (attempt.status === 'success') return this.finalize(tempPath, savePath, 'scihub', attempts, params);
        continue;
      }
    }

    // ── CNKI → Wanfang: sequential waterfall (CNKI first) ──
    if (cnkiWanfangCandidates.length > 0) {
      const cnkiCandidate = cnkiWanfangCandidates.find((c) => c.source === 'cnki');
      const wanfangCandidate = cnkiWanfangCandidates.find((c) => c.source === 'wanfang');

      // CNKI first
      if (cnkiCandidate) {
        const sourceTemp = `${tempPath}.cnki`;
        notify?.('cnki', 'start');
        const attempt = await withRetry('cnki', sourceTemp, retryConfig, () =>
          tryCnki(
            this.http, params.paperTitle!, this.cookieJar,
            sourceTemp, perSourceTimeoutMs,
            params.paperAuthors, params.paperYear,
            this.logger, this.browserSearchFn,
          ),
        );
        attempts.push(attempt);
        notify?.('cnki', 'end', { status: attempt.status, failureReason: attempt.failureReason });
        if (attempt.status === 'success') {
          return this.finalize(sourceTemp, savePath, 'cnki', attempts, params);
        }
      }

      // Wanfang fallback
      if (wanfangCandidate) {
        const sourceTemp = `${tempPath}.wanfang`;
        notify?.('wanfang', 'start');
        const attempt = await withRetry('wanfang', sourceTemp, retryConfig, () =>
          tryWanfang(
            this.http, params.paperTitle!, this.cookieJar,
            sourceTemp, perSourceTimeoutMs,
            params.paperAuthors, params.paperYear,
            this.logger, this.browserSearchFn,
          ),
        );
        attempts.push(attempt);
        notify?.('wanfang', 'end', { status: attempt.status, failureReason: attempt.failureReason });
        if (attempt.status === 'success') {
          return this.finalize(sourceTemp, savePath, 'wanfang', attempts, params);
        }
      }
    }

    // ═══ Fallback: Unpaywall（如果 Recon/Strategy 未覆盖） ═══
    const triedSources = new Set(attempts.map((a) => a.source));
    // unpaywallEmail: null → 未配置（跳过）；"" → 配置了但为空（提示需要填写）；"x@y" → 正常
    const unpaywallEmail = this.config.apiKeys.unpaywallEmail;
    if (!triedSources.has('unpaywall') && !triedSources.has('openalex-oa') && doi && unpaywallEmail !== null) {
      if (!unpaywallEmail) {
        this.logger.warn('[Acquire] unpaywallEmail is empty — Unpaywall requires a valid email. Set apiKeys.unpaywallEmail in config.');
        attempts.push(makeAttempt('unpaywall', 'skipped', 0, {
          failureReason: 'unpaywallEmail not configured (set a valid email in settings)',
          failureCategory: 'no_identifier',
        }));
      } else {
        notify?.('unpaywall', 'start');
        const attempt = await withRetry('unpaywall', tempPath, retryConfig, () =>
          tryUnpaywall(this.http, this.unpaywallLimiter, doi, this.config.apiKeys.unpaywallEmail!, tempPath, perSourceTimeoutMs),
        );
        attempts.push(attempt);
        notify?.('unpaywall', 'end', { status: attempt.status, failureReason: attempt.failureReason });
        if (attempt.status === 'success') return this.finalize(tempPath, savePath, 'unpaywall', attempts, params);
      }
    }

    // ═══ 全部耗尽 ═══
    deleteFileIfExists(tempPath);

    // ── FailureMemory: 记录失败 ──
    if (this.failureMemory) {
      const paperId = doi ?? arxivId ?? pmcid ?? params.paperTitle ?? 'unknown';
      const doiPfx = extractDoiPrefix(doi);
      for (const a of attempts) {
        if (a.status === 'failed') {
          const ftMap: Record<string, AcquireFailureType> = {
            timeout: 'timeout', http_4xx: 'http_error', http_5xx: 'http_error',
            rate_limited: 'http_error', invalid_pdf: 'validation_failed',
            no_pdf_url: 'no_pdf_url', parse_error: 'unknown',
          };
          this.failureMemory.recordFailure({
            paperId,
            source: a.source,
            failureType: ftMap[a.failureCategory ?? ''] ?? 'unknown',
            doiPrefix: doiPfx,
            httpStatus: a.httpStatus,
            detail: a.failureReason,
          });
        }
      }
    }

    const summary = attempts.map((a) => `${a.source}:${a.failureReason ?? a.status}`).join('; ');
    this.logger.error('[Acquire] ALL SOURCES EXHAUSTED', undefined, {
      doi, arxivId, pmcid, attemptCount: attempts.length, summary,
      durationMs: Date.now() - pipelineStartTime,
    });

    return { status: 'failed', pdfPath: null, source: null, sha256: null, fileSize: null, attempts };
  }

  // ─── 成功后处理：重命名 + SHA-256 + ContentSanityCheck ───

  private async finalize(
    tempPath: string,
    savePath: string,
    source: string,
    attempts: AcquireAttempt[],
    params: AcquireFulltextParams,
  ): Promise<AcquireResult> {
    const dir = path.dirname(savePath);
    if (dir && dir !== '.' && dir !== savePath) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // rename 在 Windows 跨卷时会抛 EXDEV，降级为 copy + unlink
    try {
      fs.renameSync(tempPath, savePath);
    } catch (renameErr) {
      if ((renameErr as NodeJS.ErrnoException).code === 'EXDEV') {
        fs.copyFileSync(tempPath, savePath);
        fs.unlinkSync(tempPath);
      } else {
        throw renameErr;
      }
    }
    const sha256 = await computeSha256(savePath);
    const fileSize = fs.statSync(savePath).size;

    // ContentSanityCheck — skip for very large PDFs (>50 MB) to avoid memory spikes
    // under concurrent acquisition (5 workers × 50 MB = 250 MB peak)
    const SANITY_CHECK_MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (this.sanityChecker && params.paperTitle && fileSize <= SANITY_CHECK_MAX_FILE_SIZE) {
      try {
        const extractedText = await this.quickExtractText(savePath);
        if (extractedText) {
          const sanityInput: SanityCheckInput = {
            title: params.paperTitle,
            authors: params.paperAuthors ?? [],
            year: params.paperYear ?? null,
            doi: params.doi,
            extractedText,
            maxChars: this.config.acquire.sanityCheckMaxChars,
          };
          const result = await this.sanityChecker.check(sanityInput);

          if (result.verdict !== 'pass' && result.confidence >= this.config.acquire.sanityCheckConfidenceThreshold) {
            this.logger.warn('[Acquire] SanityCheck FAILED — keeping PDF for user review', {
              source, verdict: result.verdict, confidence: result.confidence,
              explanation: result.explanation, savePath,
            });
            // Don't delete the PDF — return 'suspicious' so the workflow layer
            // can mark the paper for user review instead of incrementing failureCount
            // toward the 3-strike permanent failure cutoff.
            return { status: 'suspicious', pdfPath: savePath, source, sha256, fileSize, attempts };
          }
        }
      } catch (err) {
        this.logger.warn('[Acquire] SanityCheck error (non-blocking)', {
          error: (err as Error).message,
        });
      }
    }

    // ── FailureMemory: 记录成功 ──
    if (this.failureMemory && source !== 'cached') {
      this.failureMemory.recordSuccess(source, params.doi, null);
    }

    this.logger.info('[Acquire] PDF acquired', { source, fileSize, sha256: sha256.slice(0, 8), savePath, attemptCount: attempts.length });
    return { status: 'success', pdfPath: savePath, source, sha256, fileSize, attempts };
  }

  private async quickExtractText(pdfPath: string): Promise<string | null> {
    try {
      let mupdf: { Document: { openDocument(data: Buffer | ArrayBuffer, magic: string): { loadPage(n: number): { toStructuredText(): { asText(): string; destroy?(): void }; destroy?(): void }; countPages(): number; destroy?(): void } } };
      try {
        mupdf = await import('mupdf') as typeof mupdf;
      } catch {
        try {
          const fallbackSpecifier = 'mupdf/dist/mupdf.js';
          mupdf = await import(/* @vite-ignore */ fallbackSpecifier) as typeof mupdf;
        } catch {
          return null;
        }
      }

      const buffer = await fs.promises.readFile(pdfPath);
      const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
      try {
        const pageCount = doc.countPages();
        const pages = Math.min(pageCount, 3);
        const texts: string[] = [];

        for (let i = 0; i < pages; i++) {
          const page = doc.loadPage(i);
          try {
            const stext = page.toStructuredText();
            try {
              texts.push(stext.asText());
            } finally {
              stext.destroy?.();
            }
          } finally {
            page.destroy?.();
          }
        }

        const result = texts.join('\n');
        this.logger.debug('[Acquire] quickExtractText complete', {
          pdfPath, pagesExtracted: pages, totalPages: pageCount, charCount: result.length,
        });
        return result;
      } finally {
        (doc as { destroy?(): void }).destroy?.();
      }
    } catch {
      return null;
    }
  }
}

// ═══ 工厂函数 ═══

export function createAcquireService(
  config: AbyssalConfig,
  logger: Logger,
  llmCallFn?: LlmCallFn | null,
): AcquireService {
  return new AcquireService(config, logger, llmCallFn);
}
