// ═══ Layer 2: Strategy — 智能路由与评分引擎 ═══
// 将 Recon 结果转化为评分排序的下载候选列表。
// 包含：候选生成、EZProxy URL 变异、Cookie 注入、优先级评分、FailureMemory 调整。

import type { ReconResult } from './recon';
import type { FastPathResult } from './fast-path';
import type { CookieJar } from '../infra/cookie-jar';
import type { FailureMemory } from './failure-memory';
import type { AcquireConfig } from '../types/config';
import type { Logger } from '../infra/logger';
import { resolvePublisher, resolvePublisherByDomain, getCookieDomainsForHost } from './publisher-resolver';

// ─── Types ───

export interface DownloadCandidate {
  /** 唯一标识 */
  id: string;
  /** 数据源标签（用于 AcquireAttempt 归因） */
  source: string;
  /** 下载目标 URL */
  url: string;
  /** 优先级分数（越高越优先） */
  score: number;
  /** 附加 HTTP 请求头（Cookie、Referer 等） */
  headers: Record<string, string>;
  /** 是否为复杂源（需要特殊执行逻辑，不参与投机并行） */
  complex: boolean;
  /** 跳过 preflight HEAD 检查（已知直出 PDF 的高置信度源） */
  skipPreflight: boolean;
  /** 是否强制使用代理 HttpClient（Sci-Hub、DOI Redirect 等被墙源） */
  useProxy: boolean;
  /** 评分明细（调试用） */
  scoreBreakdown: Record<string, number>;
}

export interface StrategyResult {
  /** Phase A: 投机并行候选（按 score 降序） */
  simpleCandidates: DownloadCandidate[];
  /** Phase B: 顺序兜底候选 */
  complexCandidates: DownloadCandidate[];
  /** 候选总数 */
  candidateCount: number;
}

export interface BuildStrategyParams {
  doi: string | null;
  arxivId: string | null;
  pmcid: string | null;
  /** 用户手动提供的 PDF URL（来自 AcquireFulltextParams.url） */
  url: string | null;
  recon: ReconResult | null;
  fastPath: FastPathResult;
  cookieJar: CookieJar | null;
  failureMemory: FailureMemory | null;
  config: AcquireConfig;
  logger: Logger;
}

// ─── Score Constants ───

const SCORES = {
  FAST_PATH_OA: 95,
  OPENALEX_PDF: 90,
  CROSSREF_PDF: 85,
  UNPAYWALL: 80,
  OPENALEX_REPO: 75,
  HTML_EXTRACTED: 70,
  INSTITUTIONAL_COOKIE: 65,
  EZPROXY: 60,
  PUBLISHER_DIRECT: 50,
  PMC: 40,
  CNKI: 36,
  WANFANG: 34,
  SCIHUB: 30,
  COOKIE_BOOST: 10,
  FAILURE_PENALTY_FACTOR: 30,
} as const;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── EZProxy URL 变异 ───

/**
 * 将出版商 URL 通过 EZProxy 模板重写。
 * 模板格式: "https://{hostname}.ezproxy.lib.uni.edu/{path}"
 * {hostname} 中的点号替换为连字符（EZProxy 标准约定）。
 */
export function rewriteEzproxyUrl(originalUrl: string, template: string): string | null {
  try {
    const parsed = new URL(originalUrl);
    const hostname = parsed.hostname.replace(/\./g, '-');
    const path = parsed.pathname + parsed.search + parsed.hash;
    return template
      .replace('{hostname}', hostname)
      .replace('{path}', path);
  } catch {
    return null;
  }
}

// ─── 主函数 ───

export function buildStrategy(params: BuildStrategyParams): StrategyResult {
  const {
    doi, arxivId: _arxivId, pmcid, url: userUrl, recon, fastPath,
    cookieJar, failureMemory, config, logger,
  } = params;

  const candidates: DownloadCandidate[] = [];
  const seenUrls = new Set<string>();
  let idCounter = 0;

  const addCandidate = (
    source: string,
    url: string,
    baseScore: number,
    opts: {
      complex?: boolean;
      skipPreflight?: boolean;
      useProxy?: boolean;
      headers?: Record<string, string>;
      extraBreakdown?: Record<string, number>;
    } = {},
  ) => {
    // URL 去重：保留最高分
    if (seenUrls.has(url)) {
      const existing = candidates.find((c) => c.url === url);
      if (existing && existing.score >= baseScore) return;
      // 替换为更高分
      if (existing) {
        const idx = candidates.indexOf(existing);
        candidates.splice(idx, 1);
        seenUrls.delete(url);
      }
    }
    seenUrls.add(url);

    const breakdown: Record<string, number> = { base: baseScore, ...(opts.extraBreakdown ?? {}) };

    // Cookie 加成
    let cookieHeader: string | null = null;
    if (cookieJar && !opts.complex) {
      cookieHeader = cookieJar.getCookieHeader(url);
      if (cookieHeader) {
        breakdown['cookie_boost'] = SCORES.COOKIE_BOOST;
      }
    }

    // FailureMemory 惩罚
    let failurePenalty = 0;
    if (failureMemory && doi) {
      const publisher = recon?.publisherDomain ?? null;
      const ordering = failureMemory.getSourceOrdering([source], doi, publisher);
      // 如果该 source 被降级（不在第一位），施加惩罚
      // 简化：从 FailureMemory 的内存缓存读取失败率
      // getSourceOrdering 返回的是排序后的列表，此处用间接方式估计
      if (ordering.length > 0 && ordering[0] !== source) {
        failurePenalty = -Math.round(SCORES.FAILURE_PENALTY_FACTOR * 0.5);
        breakdown['failure_penalty'] = failurePenalty;
      }
    }

    const totalScore = baseScore + (cookieHeader ? SCORES.COOKIE_BOOST : 0) + failurePenalty;

    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: 'application/pdf,*/*',
      ...opts.headers,
    };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }
    // Referer
    try {
      headers['Referer'] = new URL(url).origin + '/';
    } catch { /* ignore */ }

    candidates.push({
      id: `candidate-${idCounter++}`,
      source,
      url,
      score: totalScore,
      headers,
      complex: opts.complex ?? false,
      skipPreflight: opts.skipPreflight ?? false,
      useProxy: opts.useProxy ?? false,
      scoreBreakdown: breakdown,
    });
  };

  // ── 1. Fast Path 候选 ──
  // Known direct PDF endpoints (arXiv, PMC, bioRxiv, Zenodo) — skip preflight HEAD
  if (fastPath.matched && fastPath.pdfUrl) {
    addCandidate(fastPath.source ?? 'fast-path', fastPath.pdfUrl, SCORES.FAST_PATH_OA, { skipPreflight: true });
  }

  // ── 2. OpenAlex PDF URLs ──
  if (recon?.openAlexData) {
    // OpenAlex pdfUrls are typically direct PDF links — skip preflight
    for (const url of recon.openAlexData.pdfUrls) {
      addCandidate('openalex-oa', url, SCORES.OPENALEX_PDF, { skipPreflight: true });
    }
    // Repository URLs may be landing pages — keep preflight
    for (const url of recon.openAlexData.repositoryUrls) {
      addCandidate('openalex-repo', url, SCORES.OPENALEX_REPO);
    }
  }

  // ── 3. CrossRef PDF Links ──
  if (recon?.crossRefData) {
    // CrossRef PDF links are usually direct — skip preflight
    for (const url of recon.crossRefData.pdfLinks) {
      addCandidate('crossref-pdf', url, SCORES.CROSSREF_PDF, { skipPreflight: true });
    }
  }

  // ── 3b. 用户手动提供的 PDF URL ──
  if (userUrl) {
    addCandidate('user-url', userUrl, 72); // 介于 OPENALEX_REPO(75) 和 INSTITUTIONAL_COOKIE(65) 之间
  }

  // ── 4. Unpaywall（通过 Recon OpenAlex 已覆盖，此处作为独立候选备份） ──
  // Unpaywall 在 recon 阶段未直接查询（OpenAlex 包含 Unpaywall 数据），
  // 如果 OpenAlex 无结果但配置了 Unpaywall email，保留为候选
  if (doi && config.enabledSources.includes('unpaywall') && (!recon?.openAlexData || recon.openAlexData.pdfUrls.length === 0)) {
    // Unpaywall 需要运行时查询，标记为特殊候选（在投机执行时调用 tryUnpaywall）
    // 此处不生成 URL，由 speculative-executor 特殊处理
    // → 不加入候选列表，保留现有 unpaywall 作为 fallback
  }

  // ── 5. Institutional (基于 Recon 的 Publisher Domain) ──
  if (doi && recon?.publisherDomain) {
    const domainPattern = resolvePublisherByDomain(recon.publisherDomain);
    const publisherCookieDomains = domainPattern?.cookieDomains
      ?? getCookieDomainsForHost(recon.publisherDomain);

    const hasCookies = cookieJar?.hasCookiesFor(publisherCookieDomains) ?? false;

    logger.debug('[Strategy] Institutional check', {
      publisherDomain: recon.publisherDomain,
      matchedPublisher: domainPattern?.name ?? '(domain fallback)',
      cookieDomains: publisherCookieDomains.join(', '),
      hasCookies,
      hasCookieJar: !!cookieJar,
    });

    if (hasCookies) {
      // 使用出版商的 PDF URL 模板
      const pdfUrl = domainPattern?.resolvePdfUrl(doi)
        ?? recon.resolvedUrl
        ?? `https://doi.org/${encodeURIComponent(doi)}`;
      addCandidate('institutional', pdfUrl, SCORES.INSTITUTIONAL_COOKIE);
    }

    // 出版商直链（无认证，低优先级）
    if (recon.resolvedUrl && recon.resolvedUrl !== `https://doi.org/${doi}`) {
      addCandidate('publisher-direct', recon.resolvedUrl, SCORES.PUBLISHER_DIRECT);
    }
  } else if (doi) {
    // ── publisherDomain 为 null（DOI HEAD 失败）→ 尝试从 OpenAlex landingPageUrls 推断 ──
    let inferredDomain: string | null = null;
    if (recon?.openAlexData?.landingPageUrls.length) {
      try {
        inferredDomain = new URL(recon.openAlexData.landingPageUrls[0]!).hostname;
        logger.debug('[Strategy] Inferred publisher domain from OpenAlex landing page', {
          url: recon.openAlexData.landingPageUrls[0],
          inferredDomain,
        });
      } catch { /* ignore */ }
    }

    if (inferredDomain) {
      // 用推断的域名走 institutional 路径
      const domainPattern = resolvePublisherByDomain(inferredDomain);
      const publisherCookieDomains = domainPattern?.cookieDomains
        ?? getCookieDomainsForHost(inferredDomain);
      const hasCookies = cookieJar?.hasCookiesFor(publisherCookieDomains) ?? false;

      logger.debug('[Strategy] Institutional check (inferred domain)', {
        inferredDomain,
        matchedPublisher: domainPattern?.name ?? '(domain fallback)',
        cookieDomains: publisherCookieDomains.join(', '),
        hasCookies,
      });

      if (hasCookies && domainPattern) {
        addCandidate('institutional-inferred', domainPattern.resolvePdfUrl(doi), SCORES.INSTITUTIONAL_COOKIE);
      }
      // 出版商直链 — 用 OpenAlex landing page URL
      if (recon?.openAlexData?.landingPageUrls?.[0]) {
        addCandidate('publisher-landing', recon.openAlexData.landingPageUrls[0], SCORES.PUBLISHER_DIRECT);
      }
    }

    // 传统 DOI 前缀匹配（最终兜底）
    const publisher = resolvePublisher(doi);
    logger.debug('[Strategy] Institutional legacy fallback', {
      doi, publisher: publisher.name,
      cookieDomains: publisher.cookieDomains.join(', ') || '(none)',
      hasCookies: cookieJar?.hasCookiesFor(publisher.cookieDomains) ?? false,
    });
    if (publisher.cookieDomains.length > 0) {
      const hasCookies = cookieJar?.hasCookiesFor(publisher.cookieDomains) ?? false;
      if (hasCookies) {
        addCandidate('institutional-legacy', publisher.resolvePdfUrl(doi), SCORES.INSTITUTIONAL_COOKIE);
      }
    }
  }

  // ── 6. EZProxy 变异 ──
  if (config.ezproxyUrlTemplate && recon?.resolvedUrl) {
    const ezUrl = rewriteEzproxyUrl(recon.resolvedUrl, config.ezproxyUrlTemplate);
    if (ezUrl) {
      addCandidate('ezproxy', ezUrl, SCORES.EZPROXY);
    }
  }
  // 也对出版商 PDF URL 做 EZProxy 变异
  if (config.ezproxyUrlTemplate && doi) {
    const publisher = recon?.publisherDomain
      ? resolvePublisherByDomain(recon.publisherDomain)
      : resolvePublisher(doi);
    if (publisher && publisher.cookieDomains.length > 0) {
      const pubPdfUrl = publisher.resolvePdfUrl(doi);
      const ezUrl = rewriteEzproxyUrl(pubPdfUrl, config.ezproxyUrlTemplate);
      if (ezUrl) {
        addCandidate('ezproxy-pdf', ezUrl, SCORES.EZPROXY);
      }
    }
  }

  // ── 6b. DOI Redirect 兜底 ──
  // 当所有 OA/institutional 路径均未产出 simple 候选时，
  // 至少用 DOI redirect 作为最低优先级候选（preflight 可能从 HTML 中提取到 PDF URL）
  if (doi && !candidates.some((c) => !c.complex)) {
    const doiUrl = `https://doi.org/${encodeURIComponent(doi)}`;
    addCandidate('doi-redirect', doiUrl, 35, { useProxy: true }); // 比 PMC(40) 低，但比 SCIHUB(30) 高
    logger.debug('[Strategy] No simple candidates yet, added doi-redirect as fallback');
  }

  // ── 7. 复杂源：PMC ──
  if ((pmcid || doi) && config.enabledSources.includes('pmc')) {
    // PMC 需要特殊执行逻辑（PMCID 解析 + tar.gz 提取），标记为 complex
    const pmcUrl = pmcid
      ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`
      : `pmc:doi:${doi}`;
    addCandidate('pmc', pmcUrl, SCORES.PMC, { complex: true });
  }

  // ── 8. 复杂源：CNKI (知网) ──
  if (config.enableCnki) {
    addCandidate('cnki', 'cnki:title-search', SCORES.CNKI, { complex: true });
  }

  // ── 9. 复杂源：Wanfang (万方) ──
  if (config.enableWanfang) {
    addCandidate('wanfang', 'wanfang:title-search', SCORES.WANFANG, { complex: true });
  }

  // ── 10. 复杂源：Sci-Hub ──
  if (doi && config.enableScihub) {
    const domain = config.scihubDomain ?? 'sci-hub.se';
    addCandidate('scihub', `https://${domain}/${doi}`, SCORES.SCIHUB, { complex: true, useProxy: true });
  }

  // ── 分离 simple / complex 并排序 ──
  const simpleCandidates = candidates
    .filter((c) => !c.complex)
    .sort((a, b) => b.score - a.score);

  const complexCandidates = candidates
    .filter((c) => c.complex)
    .sort((a, b) => b.score - a.score);

  logger.info('[Strategy] Candidates built', {
    total: candidates.length,
    simple: simpleCandidates.length,
    complex: complexCandidates.length,
    all: candidates.map((c) => `${c.source}(${c.score})${c.complex ? '[complex]' : ''}`).join(', '),
  });
  // URL 级别日志（debug 级别避免刷屏）
  for (const c of candidates) {
    logger.debug('[Strategy] Candidate detail', {
      source: c.source, score: c.score, complex: c.complex,
      url: c.url.slice(0, 120),
      breakdown: JSON.stringify(c.scoreBreakdown),
    });
  }

  return {
    simpleCandidates,
    complexCandidates,
    candidateCount: candidates.length,
  };
}
