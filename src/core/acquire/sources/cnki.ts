// ═══ CNKI (知网) Source ═══
// 通过 CARSI 登录获取 cookie 后，按标题搜索并下载 PDF
// 适用于无 DOI 的中文论文

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import type { CookieJar } from '../../infra/cookie-jar';
import type { Logger } from '../../infra/logger';
import type { BrowserSearchFn } from '../index';
import { copyFile, unlink } from 'fs/promises';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt, makeFailedAttempt } from '../attempt-utils';
import { parseSetCookieHeaders, mergeCookieStrings } from '../../infra/cookie-utils';
import { cjkTitleMatch } from '../cjk-match';

const SOURCE_NAME = 'cnki';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// KNS8 cross-database product codes (总库)
const KUAKU_CODE = 'YSTT4HG0,LSTPFY1C,JUP3MUPD,MPMFIG1A,EMRPGLPA,WQ0UVIAA,BLZOG7CK,PWFIRAGL,NN3FJMUV,NLBO1Z6R';

// ─── CNKI KNS8 API search ───

interface CnkiSearchResult {
  title: string;
  fileName: string;
  dbName: string;
  detailUrl: string;
}

/**
 * Build the QueryJson for CNKI KNS8 title search.
 */
function buildQueryJson(title: string): string {
  return JSON.stringify({
    Platform: '',
    Resource: 'CROSSDB',
    Classid: 'WD0FTY92',
    Products: '',
    QNode: {
      QGroup: [
        {
          Key: 'Subject',
          Title: '',
          Logic: 0,
          Items: [],
          ChildItems: [
            {
              Key: 'input[data-tipid=gradetxt-1]',
              Title: '篇名',
              Logic: 0,
              Items: [
                {
                  Key: 'input[data-tipid=gradetxt-1]',
                  Title: '篇名',
                  Logic: 0,
                  Field: 'TI',
                  Operator: 'DEFAULT',
                  Value: title,
                  Value2: '',
                },
              ],
              ChildItems: [],
            },
          ],
        },
        {
          Key: 'ControlGroup',
          Title: '',
          Logic: 0,
          Items: [],
          ChildItems: [],
        },
      ],
    },
    ExScope: '1',
    SearchType: 1,
    Rlang: 'CHINESE',
    KuaKuCode: KUAKU_CODE,
  });
}

/**
 * Parse CNKI KNS8 brief/grid response HTML fragment.
 * The API returns a table HTML fragment with search results.
 */
function parseGridResponse(html: string): CnkiSearchResult[] {
  const results: CnkiSearchResult[] = [];

  // Pattern 1: KNS8 grid table row — <a class="fz14" href="...">title</a>
  const linkPattern = /<a[^>]+class="fz14"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1] ?? '';
    const rawTitle = (match[2] ?? '').replace(/<[^>]*>/g, '').trim();
    if (!rawTitle || !href) continue;

    const fileNameMatch = href.match(/[?&](?:FileName|filename|v)=([^&]+)/i);
    const dbNameMatch = href.match(/[?&](?:DbName|dbname|DbCode|dbcode)=([^&]+)/i);

    const fileName = fileNameMatch?.[1] ?? '';
    const dbName = dbNameMatch?.[1] ?? '';

    if (fileName || rawTitle.length > 2) {
      results.push({
        title: rawTitle,
        fileName,
        dbName,
        detailUrl: href.startsWith('http') ? href : `https://kns.cnki.net${href}`,
      });
    }
  }

  // Pattern 2: data-filename attribute rows
  if (results.length === 0) {
    const rowPattern = /data-filename="([^"]+)"[^>]*data-dbname="([^"]+)"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = rowPattern.exec(html)) !== null) {
      const fileName = match[1] ?? '';
      const dbName = match[2] ?? '';
      const rawTitle = (match[3] ?? '').replace(/<[^>]*>/g, '').trim();
      if (fileName && rawTitle) {
        results.push({
          title: rawTitle,
          fileName,
          dbName,
          detailUrl: `https://kns.cnki.net/kcms2/article/abstract?filename=${fileName}&dbname=${dbName}`,
        });
      }
    }
  }

  // Pattern 3: fallback — any <a> with kcms in href
  if (results.length === 0) {
    const fallbackPattern = /<a[^>]+href="([^"]*kcms[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = fallbackPattern.exec(html)) !== null) {
      const href = match[1] ?? '';
      const rawTitle = (match[2] ?? '').replace(/<[^>]*>/g, '').trim();
      if (rawTitle.length > 4) {
        const fileNameMatch = href.match(/[?&](?:filename|v)=([^&]+)/i);
        const dbNameMatch = href.match(/[?&](?:dbname|dbcode)=([^&]+)/i);
        results.push({
          title: rawTitle,
          fileName: fileNameMatch?.[1] ?? '',
          dbName: dbNameMatch?.[1] ?? '',
          detailUrl: href.startsWith('http') ? href : `https://kns.cnki.net${href}`,
        });
      }
    }
  }

  return results;
}

/**
 * Extract PDF download URL from CNKI article detail page.
 */
function extractDownloadUrl(html: string, fileName: string, dbName: string): string | null {
  const pdfDownPatterns = [
    /id="pdfDown"[^>]*href="([^"]+)"/i,
    /class="btn-dlpdf"[^>]*href="([^"]+)"/i,
    /href="([^"]*download[^"]*type=pdf[^"]*)"/i,
    /href="([^"]*\/PDF\/[^"]*)"/i,
  ];

  for (const pattern of pdfDownPatterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      let url = match[1];
      if (url.startsWith('/')) url = `https://kns.cnki.net${url}`;
      return url;
    }
  }

  if (fileName && dbName) {
    return `https://kns.cnki.net/kcms2/article/abstract?filename=${encodeURIComponent(fileName)}&dbname=${encodeURIComponent(dbName)}&dbcode=${encodeURIComponent(dbName)}&v=pdf`;
  }

  return null;
}

/** CNKI-related URLs to collect cookies from */
const CNKI_COOKIE_URLS = [
  'https://kns.cnki.net/',
  'https://fsso.cnki.net/',
  'https://cnki.net/',
  'https://www.cnki.net/',
  'https://kns8.cnki.net/',
];

// ─── Search via a specific KNS8 host ───

async function searchOnHost(
  http: HttpClient,
  host: string,
  title: string,
  carsiCookie: string | null,
  cookieJar: CookieJar,
  timeoutMs: number,
  log: Logger | null,
): Promise<{ results: CnkiSearchResult[]; sessionCookies: string[]; bodySnippet: string }> {
  const sessionCookies: string[] = [];

  const baseHeaders: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(carsiCookie ? { Cookie: carsiCookie } : {}),
  };

  // ── Step 0a: Bridge from FSSO → KNS session ──
  // CARSI login only sets cookies on fsso.cnki.net. We need to visit the FSSO
  // portal which redirects to kns.cnki.net, establishing a proper KNS session.
  if (carsiCookie) {
    try {
      log?.info(`[CNKI] ${host} FSSO bridge`);
      const bridgeUrl = 'https://fsso.cnki.net/Secure/default.aspx';
      const bridgeResp = await http.request(bridgeUrl, {
        timeoutMs: Math.min(timeoutMs, 10_000),
        headers: baseHeaders,
      });
      const bridgeCookies = parseSetCookieHeaders(bridgeResp.headers);
      sessionCookies.push(...bridgeCookies);
      // Persist bridge cookies back to CookieJar
      cookieJar.mergeFromHeaders(bridgeUrl, bridgeResp.headers);
      log?.info(`[CNKI] ${host} FSSO bridge result`, {
        status: bridgeResp.status,
        finalUrl: bridgeResp.url?.slice(0, 100) ?? '',
        cookies: bridgeCookies.map((c) => c.split('=')[0]).join(', '),
        bodyLen: bridgeResp.body?.length ?? 0,
      });
    } catch (err) {
      log?.warn(`[CNKI] ${host} FSSO bridge failed`, { error: (err as Error).message });
    }
  }

  // ── Step 0b: Warm up KNS session ──
  const warmupUrl = `https://${host}/kns8s/AdvSearch?classid=WD0FTY92`;
  const warmupCookie = mergeCookieStrings(carsiCookie, sessionCookies);

  try {
    const warmupResp = await http.request(warmupUrl, {
      timeoutMs: Math.min(timeoutMs, 10_000),
      headers: {
        ...baseHeaders,
        ...(warmupCookie ? { Cookie: warmupCookie } : {}),
      },
    });

    const warmupSetCookies = parseSetCookieHeaders(warmupResp.headers);
    sessionCookies.push(...warmupSetCookies);
    // Persist warmup cookies back to CookieJar
    cookieJar.mergeFromHeaders(warmupUrl, warmupResp.headers);
    log?.info(`[CNKI] ${host} warmup`, {
      status: warmupResp.status,
      sessionCookies: sessionCookies.map((c) => c.split('=')[0]).join(', '),
      bodyLen: warmupResp.body?.length ?? 0,
    });
  } catch (err) {
    log?.warn(`[CNKI] ${host} warmup failed`, { error: (err as Error).message });
  }

  // Merge CARSI cookies with all session cookies collected so far
  const mergedCookie = mergeCookieStrings(carsiCookie, sessionCookies);

  // ── Step 1: Search via KNS8 grid API ──
  const searchApiUrl = `https://${host}/kns8s/brief/grid`;
  const queryJson = buildQueryJson(title);
  const formBody = new URLSearchParams({
    boolSearch: 'true',
    QueryJson: queryJson,
    pageNum: '1',
    pageSize: '20',
    sortField: 'PT',
    sortType: 'desc',
    dstyle: 'listmode',
    productStr: KUAKU_CODE,
    aside: '',
    searchFrom: '',
    CurPage: '1',
  }).toString();

  const searchHeaders: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Referer: warmupUrl,
    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    Accept: 'text/html, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(mergedCookie ? { Cookie: mergedCookie } : {}),
  };

  const searchResp = await http.request(searchApiUrl, {
    method: 'POST',
    timeoutMs,
    headers: searchHeaders,
    body: formBody,
  });

  // Capture and persist new cookies from the search response
  const searchSessionCookies = parseSetCookieHeaders(searchResp.headers);
  if (searchSessionCookies.length > 0) {
    sessionCookies.push(...searchSessionCookies);
    cookieJar.mergeFromHeaders(searchApiUrl, searchResp.headers);
  }

  const bodySnippet = searchResp.body?.slice(0, 300) ?? '';

  log?.info(`[CNKI] ${host} search response`, {
    status: searchResp.status,
    bodyLen: searchResp.body?.length ?? 0,
    bodySnippet,
    hasNoData: searchResp.body?.includes('暂无数据') ?? false,
  });

  const results = parseGridResponse(searchResp.body);
  return { results, sessionCookies, bodySnippet };
}

// ─── Public API ───

export async function tryCnki(
  http: HttpClient,
  title: string,
  cookieJar: CookieJar | null,
  tempPath: string,
  timeoutMs: number,
  _authors?: string[],
  _year?: number | null,
  logger?: Logger | null,
  browserSearchFn?: BrowserSearchFn | null,
): Promise<AcquireAttempt> {
  const start = Date.now();
  const log = logger ?? null;

  // Check cookies
  if (!cookieJar || !cookieJar.hasCookiesFor(['cnki.net', 'cnki.com.cn', 'kns.cnki.net'])) {
    return makeAttempt(SOURCE_NAME, 'skipped', Date.now() - start, {
      failureReason: 'No CNKI session. CARSI login required.',
    });
  }

  // Collect cookies from ALL CNKI-related domains (CARSI sets cookies on fsso.cnki.net,
  // not kns.cnki.net, so a single getCookieHeader would miss them)
  const carsiCookie = cookieJar.collectCookies(CNKI_COOKIE_URLS);
  const activeDomains = cookieJar.getActiveDomains().filter((d) => d.includes('cnki'));

  try {
    log?.info('[CNKI] Searching', {
      title: title.slice(0, 50),
      hasCARSI: !!carsiCookie,
      activeCnkiDomains: activeDomains.join(', '),
      cookiePreview: carsiCookie?.slice(0, 100) ?? null,
      hasBrowserSearch: !!browserSearchFn,
    });

    let searchResults: CnkiSearchResult[] = [];
    let allSessionCookies: string[] = [];
    /** Download URL extracted by BrowserWindow (from detail page) */
    let browserDownloadUrl: string | null = null;
    /** Session cookies exported from the BrowserWindow session */
    let browserSessionCookies: string | null = null;
    /** Path to PDF already downloaded by BrowserWindow (via will-download interception) */
    let browserDownloadedPath: string | null = null;

    // ── Primary: BrowserWindow-based search (handles CAPTCHA + JS-established session) ──
    if (browserSearchFn) {
      log?.info('[CNKI] Using BrowserWindow search');
      try {
        const browserResults = await browserSearchFn('cnki', title, {
          ...(_authors ? { authors: _authors } : {}),
          ...(_year != null ? { year: _year } : {}),
        });
        if (browserResults.length > 0) {
          // Capture download URL, session cookies, and downloaded file from the first result
          browserDownloadUrl = browserResults[0]?.downloadUrl ?? null;
          browserSessionCookies = browserResults[0]?.metadata['sessionCookies'] ?? null;
          browserDownloadedPath = browserResults[0]?.metadata['downloadedTempPath'] ?? null;

          searchResults = browserResults.map((r) => ({
            title: r.title,
            fileName: r.metadata['fileName'] ?? '',
            dbName: r.metadata['dbName'] ?? '',
            detailUrl: r.detailUrl,
          }));
          log?.info('[CNKI] BrowserWindow search results', {
            count: searchResults.length,
            titles: searchResults.slice(0, 3).map((r) => r.title.slice(0, 40)),
            hasDownloadUrl: !!browserDownloadUrl,
            hasSessionCookies: !!browserSessionCookies,
          });
        } else {
          log?.info('[CNKI] BrowserWindow search returned no results, falling back to HTTP');
        }
      } catch (err) {
        log?.warn('[CNKI] BrowserWindow search failed, falling back to HTTP', {
          error: (err as Error).message,
        });
      }
    }

    // ── Fallback: HTTP-based search ──
    if (searchResults.length === 0) {
      // Attempt 1: kns.cnki.net (domestic)
      try {
        const r = await searchOnHost(http, 'kns.cnki.net', title, carsiCookie, cookieJar, timeoutMs, log);
        searchResults = r.results;
        allSessionCookies = r.sessionCookies;
      } catch (err) {
        log?.warn('[CNKI] Domestic search failed', { error: (err as Error).message });
      }

      // Attempt 2: oversea.cnki.net (fallback)
      if (searchResults.length === 0) {
        log?.info('[CNKI] Trying overseas endpoint');
        try {
          const overseaCookie = cookieJar.getCookieHeader('https://oversea.cnki.net/');
          const r = await searchOnHost(http, 'oversea.cnki.net', title, overseaCookie ?? carsiCookie, cookieJar, timeoutMs, log);
          searchResults = r.results;
          allSessionCookies = r.sessionCookies;
        } catch (err) {
          log?.warn('[CNKI] Overseas search failed', { error: (err as Error).message });
        }
      }
    }

    log?.info('[CNKI] Parsed results', {
      count: searchResults.length,
      titles: searchResults.slice(0, 3).map((r) => r.title.slice(0, 40)),
    });

    if (searchResults.length === 0) {
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: `No results found on CNKI for "${title.slice(0, 50)}"`,
        failureCategory: 'no_pdf_url',
      });
    }

    // ── Step 2: Match ──
    let bestMatch: CnkiSearchResult | null = null;
    let bestScore = 0;
    for (const result of searchResults) {
      const score = cjkTitleMatch(title, result.title);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    log?.info('[CNKI] Best match', {
      score: bestScore.toFixed(2),
      title: bestMatch?.title.slice(0, 50) ?? null,
    });

    if (!bestMatch || bestScore < 0.6) {
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: `No matching paper on CNKI (best similarity: ${bestScore.toFixed(2)}, title: "${searchResults[0]?.title.slice(0, 40) ?? ''}")`,
        failureCategory: 'no_pdf_url',
      });
    }

    // ── Step 3: Get download URL ──
    let downloadUrl: string | null = null;

    // If BrowserWindow already extracted the download URL from the detail page, use it directly
    if (browserDownloadUrl) {
      downloadUrl = browserDownloadUrl;
      log?.info('[CNKI] Using download URL from BrowserWindow', { url: downloadUrl.slice(0, 100) });
    } else {
      // Fallback: fetch the detail page via HTTP and extract download URL
      const detailBaseCookie = cookieJar.getCookieHeader(bestMatch.detailUrl);
      const detailCookie = mergeCookieStrings(detailBaseCookie, allSessionCookies);
      const detailHeaders: Record<string, string> = {
        'User-Agent': BROWSER_UA,
        Referer: 'https://kns.cnki.net/kns8s/AdvSearch?classid=WD0FTY92',
        Accept: 'text/html,application/xhtml+xml,*/*',
        ...(detailCookie ? { Cookie: detailCookie } : {}),
      };

      const detailResp = await http.request(bestMatch.detailUrl, {
        timeoutMs,
        headers: detailHeaders,
      });

      downloadUrl = extractDownloadUrl(detailResp.body, bestMatch.fileName, bestMatch.dbName);

      if (!downloadUrl && bestMatch.fileName) {
        downloadUrl = `https://kns.cnki.net/kcms2/article/abstract?filename=${encodeURIComponent(bestMatch.fileName)}&dbname=${encodeURIComponent(bestMatch.dbName)}`;
      }
    }

    if (!downloadUrl && !browserDownloadedPath) {
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: 'Could not extract PDF download URL from CNKI detail page',
        failureCategory: 'no_pdf_url',
      });
    }

    log?.info('[CNKI] Download URL', {
      url: downloadUrl?.slice(0, 100) ?? null,
      hasBrowserDownload: !!browserDownloadedPath,
    });

    // ── Step 4: Download ──
    // 4a: If BrowserWindow already downloaded the PDF via will-download, use it directly
    if (browserDownloadedPath) {
      log?.info('[CNKI] Using BrowserWindow-downloaded file', { from: browserDownloadedPath });
      try {
        await copyFile(browserDownloadedPath, tempPath);
        await unlink(browserDownloadedPath).catch(() => {});
      } catch (copyErr) {
        log?.warn('[CNKI] Failed to copy browser download, trying HTTP', {
          error: (copyErr as Error).message,
        });
        browserDownloadedPath = null; // fall through to HTTP
      }
    }

    // 4b: HTTP download fallback
    if (!browserDownloadedPath && downloadUrl) {
      const dlCookieParts: string[] = [];
      if (browserSessionCookies) {
        dlCookieParts.push(browserSessionCookies);
      }
      const dlBaseCookie = cookieJar.getCookieHeader(downloadUrl);
      if (dlBaseCookie) dlCookieParts.push(dlBaseCookie);
      const dlCookie = dlCookieParts.join('; ') || mergeCookieStrings(carsiCookie, allSessionCookies);

      const dlHeaders: Record<string, string> = {
        'User-Agent': BROWSER_UA,
        Referer: bestMatch.detailUrl,
        Accept: 'application/pdf,*/*',
        ...(dlCookie ? { Cookie: dlCookie } : {}),
      };

      await downloadPdf(http, downloadUrl, tempPath, timeoutMs, dlHeaders);
    }

    // ── Step 5: Validate ──
    const validation = await validatePdf(tempPath);
    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      const reason = validation.reason ?? 'PDF validation failed';
      const isFormat = reason.includes('magic') || reason.includes('signature') || reason.includes('not a PDF');
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: isFormat
          ? 'CNKI returned non-PDF content (possibly CAJ format or login page). Try re-login via CARSI.'
          : `CNKI: ${reason}`,
        failureCategory: isFormat ? 'session_expired' : 'invalid_pdf',
      });
    }

    return makeAttempt(SOURCE_NAME, 'success', Date.now() - start, { httpStatus: 200 });
  } catch (err) {
    deleteFileIfExists(tempPath);
    return makeFailedAttempt(SOURCE_NAME, start, err);
  }
}
