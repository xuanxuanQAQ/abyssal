// ═══ Wanfang (万方) Source ═══
// 通过 CARSI 登录获取 cookie 后，按标题搜索并下载 PDF
// 适用于无 DOI 的中文论文

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import type { CookieJar } from '../../infra/cookie-jar';
import type { Logger } from '../../infra/logger';
import type { BrowserSearchFn } from '../index';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt, makeFailedAttempt } from '../attempt-utils';

// ─── Cookie collection helper ───

/**
 * Collect cookies from the CookieJar across multiple domains and merge them.
 * Needed because CARSI login stores cookies under www.wanfangdata.com.cn
 * which may not match s.wanfangdata.com.cn.
 */
function collectCookiesFromJar(cookieJar: CookieJar, urls: string[]): string | null {
  const parts = new Map<string, string>();
  for (const url of urls) {
    const header = cookieJar.getCookieHeader(url);
    if (header) {
      for (const pair of header.split(';')) {
        const trimmed = pair.trim();
        const eq = trimmed.indexOf('=');
        if (eq > 0) parts.set(trimmed.slice(0, eq), trimmed);
      }
    }
  }
  return parts.size > 0 ? [...parts.values()].join('; ') : null;
}

const SOURCE_NAME = 'wanfang';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── Title similarity (CJK-aware) ───

function normalizeCjk(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、；：？！""''（）【】《》\u3000]/g, '')
    .replace(/[,.\-;:?!'"()\[\]<>{}]/g, '')
    .trim();
}

function cjkTitleMatch(query: string, candidate: string): number {
  const q = normalizeCjk(query);
  const c = normalizeCjk(candidate);
  if (q === c) return 1.0;
  if (q.length === 0 || c.length === 0) return 0;

  const setQ = new Set([...q]);
  const setC = new Set([...c]);
  const intersection = [...setQ].filter((ch) => setC.has(ch)).length;
  const union = new Set([...setQ, ...setC]).size;
  return union > 0 ? intersection / union : 0;
}

// ─── Wanfang search result parsing ───

interface WanfangSearchResult {
  title: string;
  paperId: string;
  paperType: string;
  detailUrl: string;
}

// Type slug → URL path segment
const TYPE_TO_PATH: Record<string, string> = {
  periodical: 'periodical',
  perio: 'periodical',
  thesis: 'thesis',
  conference: 'conference',
  Periodical: 'periodical',
  Thesis: 'thesis',
  Conference: 'conference',
};

/**
 * Parse Wanfang search results from SSR HTML.
 * The search page at s.wanfangdata.com.cn renders results server-side.
 *
 * Result structure (observed):
 *   <div class="normal-list">
 *     <span class="title-id-hidden">periodical_abc123</span>
 *     <a class="title" href="...">Paper Title</a>
 *     ...
 *   </div>
 */
function parseSearchHtml(html: string): WanfangSearchResult[] {
  const results: WanfangSearchResult[] = [];

  // ── Pattern 1: SSR initial state JSON ──
  const ssrPatterns = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/i,
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/i,
    /window\.__DATA__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/i,
  ];
  for (const pattern of ssrPatterns) {
    const ssrMatch = pattern.exec(html);
    if (ssrMatch?.[1]) {
      try {
        const state = JSON.parse(ssrMatch[1]);
        const list =
          state?.searchResult?.list ??
          state?.paper?.list ??
          state?.data?.list ??
          state?.paperList ??
          [];
        for (const item of list) {
          const paperId = item.id ?? item.Id ?? item.D_ID ?? '';
          const rawTitle = (Array.isArray(item.title) ? item.title[0] : item.title) ??
                        (Array.isArray(item.Title) ? item.Title[0] : item.Title) ?? '';
          const cleanTitle = typeof rawTitle === 'string' ? rawTitle.replace(/<[^>]*>/g, '').trim() : '';
          if (paperId && cleanTitle.length > 4) {
            const pType = item.type ?? item.Type ?? 'perio';
            results.push({
              title: cleanTitle,
              paperId,
              paperType: pType,
              detailUrl: `https://d.wanfangdata.com.cn/${TYPE_TO_PATH[pType] ?? 'periodical'}/${paperId}`,
            });
          }
        }
      } catch { /* JSON parse failed */ }
    }
    if (results.length > 0) return results;
  }

  // ── Pattern 2: DOM — <span class="title-id-hidden">{type}_{id}</span> ──
  // This is the primary SSR DOM pattern used by s.wanfangdata.com.cn
  const hiddenIdPattern = /class="title-id-hidden"[^>]*>([^<]+)<\/span>/gi;
  const hiddenIds: Array<{ type: string; id: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = hiddenIdPattern.exec(html)) !== null) {
    const raw = (match[1] ?? '').trim();
    const underscoreIdx = raw.indexOf('_');
    if (underscoreIdx > 0) {
      hiddenIds.push({
        type: raw.slice(0, underscoreIdx),
        id: raw.slice(underscoreIdx + 1),
        index: match.index,
      });
    }
  }

  if (hiddenIds.length > 0) {
    // For each hidden ID, find the nearest title text
    for (const hid of hiddenIds) {
      // Search within ~2000 chars after the hidden span for a title link or text
      const searchRegion = html.slice(hid.index, hid.index + 2000);

      // Try: <a class="title" ...>Title Text</a>
      const titleLinkMatch = /<a[^>]+class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(searchRegion);
      let title = '';
      if (titleLinkMatch?.[1]) {
        title = titleLinkMatch[1].replace(/<[^>]*>/g, '').trim();
      }

      // Fallback: any <a> tag with substantive text
      if (!title) {
        const anyLinkMatch = /<a[^>]+href="[^"]*(?:periodical|thesis|conference)[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(searchRegion);
        if (anyLinkMatch?.[1]) {
          title = anyLinkMatch[1].replace(/<[^>]*>/g, '').trim();
        }
      }

      if (title && title.length > 4 && hid.id) {
        const pathSegment = TYPE_TO_PATH[hid.type] ?? 'periodical';
        results.push({
          title,
          paperId: hid.id,
          paperType: hid.type,
          detailUrl: `https://d.wanfangdata.com.cn/${pathSegment}/${hid.id}`,
        });
      }
    }
    if (results.length > 0) return results;
  }

  // ── Pattern 3: DOM — normal-list blocks without hidden ID spans ──
  // <div class="normal-list"> blocks that contain title and detail links
  const normalListPattern = /class="normal-list"[\s\S]*?(?=class="normal-list"|<\/div>\s*<\/div>\s*<\/div>|$)/gi;
  while ((match = normalListPattern.exec(html)) !== null) {
    const block = match[0];
    // Extract detail URL (type + ID from URL)
    const urlMatch = /href="[^"]*(?:d\.wanfangdata\.com\.cn|\/detail)\/(?:periodical|thesis|conference)\/([^"/?#]+)"/i.exec(block);
    const titleMatch = /class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
      ?? /<a[^>]+href="[^"]*(?:periodical|thesis|conference)[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const typeMatch = /\/(periodical|thesis|conference)\//i.exec(block);

    const paperId = urlMatch?.[1] ?? '';
    const title = (titleMatch?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
    const pType = typeMatch?.[1] ?? 'periodical';

    if (paperId && title.length > 4) {
      results.push({
        title,
        paperId,
        paperType: pType,
        detailUrl: `https://d.wanfangdata.com.cn/${pType}/${paperId}`,
      });
    }
  }

  // ── Pattern 4: Direct detail links (broadest fallback) ──
  if (results.length === 0) {
    const detailLinkPattern = /href="(https?:\/\/d\.wanfangdata\.com\.cn\/(?:periodical|thesis|conference)\/([^"/?#]+))"[^>]*>([^<]+)</gi;
    while ((match = detailLinkPattern.exec(html)) !== null) {
      const paperId = match[2] ?? '';
      const rawTitle = (match[3] ?? '').trim();
      if (paperId && rawTitle.length > 6 && !rawTitle.includes('许可证') && !rawTitle.includes('备案')) {
        results.push({
          title: rawTitle,
          paperId,
          paperType: 'perio',
          detailUrl: match[1] ?? `https://d.wanfangdata.com.cn/periodical/${paperId}`,
        });
      }
    }
  }

  return results;
}

/**
 * Parse Wanfang API JSON response.
 */
function parseSearchApiResponse(jsonStr: string): WanfangSearchResult[] {
  const results: WanfangSearchResult[] = [];
  try {
    const data = JSON.parse(jsonStr);
    const items =
      data?.value?.CollList?.[0]?.RecordList ??
      data?.value?.list ??
      data?.data?.list ??
      data?.documents ??
      data?.data?.documents ??
      data?.rows ??
      data?.data?.rows ??
      [];

    for (const item of items) {
      const paperId = item.Id ?? item.id ?? item.D_ID ?? '';
      const rawTitle = item.Title?.[0] ?? item.Title ?? item.title ?? item.Name ?? '';
      const title = typeof rawTitle === 'string' ? rawTitle.replace(/<[^>]*>/g, '').trim() : '';
      const typeRaw = item.ResourceType ?? item.resource_type ?? item.Type ?? 'Periodical';
      const typeMap: Record<string, string> = { Periodical: 'perio', Thesis: 'thesis', Conference: 'conference' };

      if (paperId && title.length > 2) {
        const pType = typeMap[typeRaw] ?? 'perio';
        results.push({
          title,
          paperId,
          paperType: pType,
          detailUrl: `https://d.wanfangdata.com.cn/${TYPE_TO_PATH[pType] ?? 'periodical'}/${paperId}`,
        });
      }
    }
  } catch {
    // Not JSON — ignore
  }
  return results;
}

/**
 * Extract PDF download URL from Wanfang detail page.
 */
function extractDownloadUrl(html: string, paperId: string, paperType: string): string | null {
  const dlPatterns = [
    /href="([^"]*download[^"]*online[^"]*)"/i,
    /href="([^"]*\/PDF\/[^"]*)"/i,
    /href="([^"]*\.pdf[^"]*)"/i,
    /data-download-url="([^"]+)"/i,
  ];

  for (const pattern of dlPatterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      let url = match[1];
      if (url.startsWith('/')) url = `https://www.wanfangdata.com.cn${url}`;
      return url;
    }
  }

  // Construct standard Wanfang download URLs (try OA/OSS variant first)
  const pathSegment = TYPE_TO_PATH[paperType] ?? 'periodical';
  return `https://d.wanfangdata.com.cn/download/online?id=${encodeURIComponent(paperId)}&type=${encodeURIComponent(pathSegment)}&resourceType=${encodeURIComponent(pathSegment)}`;
}

// ─── Public API ───

export async function tryWanfang(
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
  if (!cookieJar || !cookieJar.hasCookiesFor(['wanfangdata.com.cn'])) {
    return makeAttempt(SOURCE_NAME, 'skipped', Date.now() - start, {
      failureReason: 'No Wanfang session. CARSI login required.',
    });
  }

  // Collect cookies from ALL Wanfang-related domains.
  const wanfangUrls = [
    'https://www.wanfangdata.com.cn/',
    'https://s.wanfangdata.com.cn/',
    'https://d.wanfangdata.com.cn/',
    'https://wanfangdata.com.cn/',
    'https://login.wanfangdata.com.cn/',
  ];
  const mergedCookie = collectCookiesFromJar(cookieJar, wanfangUrls);
  const activeDomains = cookieJar.getActiveDomains().filter((d) => d.includes('wanfang'));
  log?.info('[Wanfang] Cookie status', {
    hasCookies: !!mergedCookie,
    activeDomains: activeDomains.join(', '),
    cookiePreview: mergedCookie?.slice(0, 100) ?? null,
    hasBrowserSearch: !!browserSearchFn,
  });

  const baseHeaders: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Referer: 'https://www.wanfangdata.com.cn/',
    Accept: 'text/html,application/xhtml+xml,application/json,*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(mergedCookie ? { Cookie: mergedCookie } : {}),
  };

  try {
    let searchResults: WanfangSearchResult[] = [];
    /** Session cookies exported from the BrowserWindow session */
    let browserSessionCookies: string | null = null;

    log?.info('[Wanfang] Searching', { title: title.slice(0, 50) });

    // ── Primary: BrowserWindow-based search (handles SPA client-side rendering) ──
    if (browserSearchFn) {
      log?.info('[Wanfang] Using BrowserWindow search');
      try {
        const browserResults = await browserSearchFn('wanfang', title, {
          ...(_authors ? { authors: _authors } : {}),
          ...(_year != null ? { year: _year } : {}),
        });
        if (browserResults.length > 0) {
          browserSessionCookies = browserResults[0]?.metadata['sessionCookies'] ?? null;
          searchResults = browserResults.map((r) => ({
            title: r.title,
            paperId: r.metadata['paperId'] ?? '',
            paperType: r.metadata['paperType'] ?? 'perio',
            detailUrl: r.detailUrl,
          }));
          log?.info('[Wanfang] BrowserWindow search results', {
            count: searchResults.length,
            titles: searchResults.slice(0, 3).map((r) => r.title.slice(0, 40)),
            hasSessionCookies: !!browserSessionCookies,
          });
        } else {
          log?.info('[Wanfang] BrowserWindow search returned no results, falling back to HTTP');
        }
      } catch (err) {
        log?.warn('[Wanfang] BrowserWindow search failed, falling back to HTTP', {
          error: (err as Error).message,
        });
      }
    }

    // ── Fallback: HTTP-based search ──
    if (searchResults.length === 0) {
      // Step 1a: Try the SSR search page
      const spaUrl = `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(title)}&style=detail&f=D`;
      try {
        const spaResp = await http.request(spaUrl, {
          timeoutMs: Math.min(timeoutMs, 15_000),
          headers: baseHeaders,
        });

        log?.info('[Wanfang] SSR page response', {
          status: spaResp.status,
          bodyLen: spaResp.body?.length ?? 0,
          hasNormalList: spaResp.body?.includes('normal-list') ?? false,
          hasTitleIdHidden: spaResp.body?.includes('title-id-hidden') ?? false,
          hasInitialState: spaResp.body?.includes('__INITIAL_STATE__') ?? false,
          bodySnippet: spaResp.body?.slice(0, 200) ?? '',
        });

        if (spaResp.body?.trimStart().startsWith('{') || spaResp.body?.trimStart().startsWith('[')) {
          searchResults = parseSearchApiResponse(spaResp.body);
        }
        if (searchResults.length === 0) {
          searchResults = parseSearchHtml(spaResp.body);
        }

        log?.info('[Wanfang] SSR parse result', {
          count: searchResults.length,
          titles: searchResults.slice(0, 3).map((r) => r.title.slice(0, 40)),
        });
      } catch (err) {
        log?.warn('[Wanfang] SSR page request failed', { error: (err as Error).message });
      }

      // Step 1b: Try www.wanfangdata.com.cn search
      if (searchResults.length === 0) {
        log?.info('[Wanfang] Trying www search');
        const wwwUrl = `https://www.wanfangdata.com.cn/search/searchList.do?searchType=all&searchWord=${encodeURIComponent(title)}&pageSize=20&page=1&order=correlation&showType=detail`;
        try {
          const wwwResp = await http.request(wwwUrl, {
            timeoutMs: Math.min(timeoutMs, 15_000),
            headers: baseHeaders,
          });

          log?.info('[Wanfang] www search response', {
            status: wwwResp.status,
            bodyLen: wwwResp.body?.length ?? 0,
            hasNormalList: wwwResp.body?.includes('normal-list') ?? false,
            hasTitleIdHidden: wwwResp.body?.includes('title-id-hidden') ?? false,
            bodySnippet: wwwResp.body?.slice(0, 300) ?? '',
          });

          if (wwwResp.body?.trimStart().startsWith('{') || wwwResp.body?.trimStart().startsWith('[')) {
            searchResults = parseSearchApiResponse(wwwResp.body);
          }
          if (searchResults.length === 0) {
            searchResults = parseSearchHtml(wwwResp.body);
          }
        } catch (err) {
          log?.warn('[Wanfang] www search failed', { error: (err as Error).message });
        }
      }
    }

    log?.info('[Wanfang] Final parsed results', {
      count: searchResults.length,
      titles: searchResults.slice(0, 3).map((r) => r.title.slice(0, 40)),
    });

    if (searchResults.length === 0) {
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: `No results found on Wanfang for "${title.slice(0, 50)}"`,
        failureCategory: 'no_pdf_url',
      });
    }

    // ── Step 2: Match ──
    let bestMatch: WanfangSearchResult | null = null;
    let bestScore = 0;
    for (const result of searchResults) {
      const score = cjkTitleMatch(title, result.title);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    log?.info('[Wanfang] Best match', {
      score: bestScore.toFixed(2),
      title: bestMatch?.title.slice(0, 50) ?? null,
    });

    if (!bestMatch || bestScore < 0.6) {
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: `No matching paper on Wanfang (best similarity: ${bestScore.toFixed(2)}, title: "${searchResults[0]?.title.slice(0, 40) ?? ''}")`,
        failureCategory: 'no_pdf_url',
      });
    }

    // ── Step 3: Get detail page ──
    // Prefer BrowserWindow session cookies (they include the authenticated SPA session)
    const detailCookieParts: string[] = [];
    if (browserSessionCookies) detailCookieParts.push(browserSessionCookies);
    const jarDetailCookie = cookieJar.getCookieHeader(bestMatch.detailUrl);
    if (jarDetailCookie) detailCookieParts.push(jarDetailCookie);
    const detailCookie = detailCookieParts.join('; ') || mergedCookie;

    const detailHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Referer: 'https://s.wanfangdata.com.cn/',
      Accept: 'text/html,application/xhtml+xml,*/*',
      ...(detailCookie ? { Cookie: detailCookie } : {}),
    };

    const detailResp = await http.request(bestMatch.detailUrl, {
      timeoutMs,
      headers: detailHeaders,
    });

    // ── Step 4: Extract download URL ──
    const downloadUrl = extractDownloadUrl(detailResp.body, bestMatch.paperId, bestMatch.paperType);
    if (!downloadUrl) {
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: 'Could not extract PDF download URL from Wanfang detail page',
        failureCategory: 'no_pdf_url',
      });
    }

    log?.info('[Wanfang] Download URL', { url: downloadUrl.slice(0, 100) });

    // ── Step 5: Download ──
    const dlCookieParts: string[] = [];
    if (browserSessionCookies) dlCookieParts.push(browserSessionCookies);
    const jarDlCookie = cookieJar.getCookieHeader(downloadUrl);
    if (jarDlCookie) dlCookieParts.push(jarDlCookie);
    const dlCookie = dlCookieParts.join('; ') || mergedCookie;

    const dlHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Referer: bestMatch.detailUrl,
      Accept: 'application/pdf,*/*',
      ...(dlCookie ? { Cookie: dlCookie } : {}),
    };

    await downloadPdf(http, downloadUrl, tempPath, timeoutMs, dlHeaders);

    // ── Step 6: Validate ──
    const validation = await validatePdf(tempPath);
    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      const reason = validation.reason ?? 'PDF validation failed';
      const isSessionIssue = reason.includes('magic') || reason.includes('signature') || reason.includes('not a PDF');
      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: isSessionIssue
          ? 'Wanfang returned non-PDF content (session expired or login page). Try re-login via CARSI.'
          : `Wanfang: ${reason}`,
        failureCategory: isSessionIssue ? 'session_expired' : 'invalid_pdf',
      });
    }

    return makeAttempt(SOURCE_NAME, 'success', Date.now() - start, { httpStatus: 200 });
  } catch (err) {
    deleteFileIfExists(tempPath);
    return makeFailedAttempt(SOURCE_NAME, start, err);
  }
}
