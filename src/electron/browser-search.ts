/**
 * BrowserWindow-based search for CNKI and Wanfang.
 *
 * Both platforms require JavaScript execution for search:
 * - CNKI: Grid API needs server-side search context established by JS + may show CAPTCHA
 * - Wanfang: SPA — search results are entirely client-rendered
 *
 * This module opens a hidden BrowserWindow with the authenticated session,
 * navigates to the search page, waits for JS to render results, and extracts
 * them via webContents.executeJavaScript().
 */

import { BrowserWindow, session } from 'electron';
import type { Logger } from '../core/infra/logger';

// ─── Types ───

export interface BrowserSearchResult {
  title: string;
  /** Direct PDF download URL (if extractable from the page) */
  downloadUrl: string | null;
  /** Detail/abstract page URL */
  detailUrl: string;
  /** Source-specific metadata (fileName, dbName for CNKI; paperId, paperType for Wanfang) */
  metadata: Record<string, string>;
}

export type BrowserSearchFn = (
  source: 'cnki' | 'wanfang',
  title: string,
  options?: { authors?: string[]; year?: number | null },
) => Promise<BrowserSearchResult[]>;

// ─── Constants ───

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── CNKI search via BrowserWindow ───

async function searchCnkiInBrowser(
  sessionPartition: string,
  title: string,
  logger: Logger,
): Promise<BrowserSearchResult[]> {
  const ses = session.fromPartition(sessionPartition);
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);

  try {
    // Step 1: Navigate directly with search keyword in URL (skips need to find input)
    const directUrl = `https://kns.cnki.net/kns8s/defaultresult/index?crossids=WD0FTY92&kw=${encodeURIComponent(title)}&korder=SU`;
    logger.info('[BrowserSearch:CNKI] Navigating to search', { url: directUrl.slice(0, 120) });

    await win.loadURL(directUrl);
    await delay(3000);

    // Check for CAPTCHA
    const currentUrl = win.webContents.getURL().toLowerCase();
    if (currentUrl.includes('/verify') || currentUrl.includes('captcha')) {
      logger.info('[BrowserSearch:CNKI] CAPTCHA detected, showing window');
      win.show();
      win.focus();
      win.setTitle('CNKI 验证 — 请完成验证后等待自动继续');

      const captchaSolved = await waitForNavigation(win, (url) => {
        const lower = url.toLowerCase();
        return !lower.includes('/verify') && !lower.includes('captcha');
      }, 120_000);

      if (!captchaSolved) {
        logger.warn('[BrowserSearch:CNKI] CAPTCHA timeout');
        return [];
      }
      logger.info('[BrowserSearch:CNKI] CAPTCHA solved');
      await delay(2000);
      win.hide();
    }

    // Step 2: Wait for results to load
    const waitScript = `
      new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
          attempts++;
          const noData = document.querySelector('.no-content');
          if (noData) {
            resolve({ status: 'no_data', text: noData.textContent?.trim() });
            return;
          }
          const rows = document.querySelectorAll('.result-table-list table tbody tr, a.fz14');
          if (rows.length > 0) {
            resolve({ status: 'has_results', count: rows.length });
            return;
          }
          if (attempts > 30) {
            const body = document.body?.innerHTML || '';
            resolve({ status: 'timeout', bodyLen: body.length, snippet: body.slice(0, 500) });
            return;
          }
          setTimeout(check, 500);
        };
        check();
      })
    `;

    const waitResult = await win.webContents.executeJavaScript(waitScript);
    logger.info('[BrowserSearch:CNKI] Wait for results', { result: JSON.stringify(waitResult)?.slice(0, 200) });

    if (waitResult?.status === 'no_data' || waitResult?.status === 'timeout') {
      return [];
    }

    // Step 3: Extract results — get the first result's detail URL
    const extractScript = `
      (() => {
        const results = [];
        // CNKI KNS8 result links have class "fz14"
        const links = document.querySelectorAll('a.fz14');
        for (const link of links) {
          const title = (link.textContent || '').trim().replace(/<[^>]*>/g, '');
          const href = link.getAttribute('href') || '';
          if (!title || title.length < 3 || !href) continue;
          results.push({
            title,
            detailUrl: href.startsWith('http') ? href : 'https://kns.cnki.net' + href,
          });
        }
        return results;
      })()
    `;

    const searchResults: Array<{ title: string; detailUrl: string }> =
      await win.webContents.executeJavaScript(extractScript);
    logger.info('[BrowserSearch:CNKI] Search results', {
      count: searchResults?.length ?? 0,
      titles: (searchResults ?? []).slice(0, 3).map((r) => r.title?.slice(0, 40)),
    });

    if (!Array.isArray(searchResults) || searchResults.length === 0) return [];

    // Step 4: Navigate to the FIRST result's detail page to get download URL
    const bestResult = searchResults[0]!;
    logger.info('[BrowserSearch:CNKI] Navigating to detail page', { url: bestResult.detailUrl.slice(0, 120) });

    await win.loadURL(bestResult.detailUrl);
    await delay(3000);

    // Step 5: Extract download URL and metadata from the detail page
    const detailScript = `
      (() => {
        const result = { downloadUrl: null, fileName: '', dbName: '' };

        // Extract fileName from page metadata or URL
        const metaFn = document.querySelector('meta[name="FileName"], input#fileName, [name="filename"]');
        if (metaFn) result.fileName = metaFn.getAttribute('content') || metaFn.getAttribute('value') || '';

        const metaDb = document.querySelector('meta[name="DbName"], input#dbName, [name="dbname"]');
        if (metaDb) result.dbName = metaDb.getAttribute('content') || metaDb.getAttribute('value') || '';

        // Try from URL params
        if (!result.fileName) {
          const urlParams = new URLSearchParams(window.location.search);
          result.fileName = urlParams.get('FileName') || urlParams.get('filename') || urlParams.get('v') || '';
          result.dbName = result.dbName || urlParams.get('DbName') || urlParams.get('dbname') || urlParams.get('DbCode') || urlParams.get('dbcode') || '';
        }

        // Try from script variables in the page
        if (!result.fileName) {
          const scripts = document.querySelectorAll('script');
          for (const s of scripts) {
            const text = s.textContent || '';
            const fnMatch = text.match(/["']?(?:fileName|FileName)["']?\\s*[:=]\\s*["']([^"']+)["']/);
            const dbMatch = text.match(/["']?(?:dbName|DbName|dbCode|DbCode)["']?\\s*[:=]\\s*["']([^"']+)["']/);
            if (fnMatch) result.fileName = fnMatch[1];
            if (dbMatch) result.dbName = result.dbName || dbMatch[1];
            if (result.fileName) break;
          }
        }

        // Extract PDF download URL
        // Pattern 1: PDF download button
        const pdfBtn = document.getElementById('pdfDown')
          || document.querySelector('.btn-dlpdf')
          || document.querySelector('a[id*="pdfDown"]')
          || document.querySelector('a[href*="dflag=pdfdown"]')
          || document.querySelector('a[href*="type=pdf"]');
        if (pdfBtn) {
          const href = pdfBtn.getAttribute('href');
          if (href && href !== '#' && href !== 'javascript:void(0)') {
            result.downloadUrl = href.startsWith('http') ? href : 'https://kns.cnki.net' + href;
          }
        }

        // Pattern 2: onclick handler with download URL
        if (!result.downloadUrl) {
          const dlBtns = document.querySelectorAll('[onclick*="download"], [onclick*="Download"]');
          for (const btn of dlBtns) {
            const onclick = btn.getAttribute('onclick') || '';
            const urlMatch = onclick.match(/['"](\\/[^'"]*(?:download|pdf)[^'"]*)['"]/i);
            if (urlMatch) {
              result.downloadUrl = 'https://kns.cnki.net' + urlMatch[1];
              break;
            }
          }
        }

        // Pattern 3: Construct download URL from fileName and dbName
        if (!result.downloadUrl && result.fileName && result.dbName) {
          result.downloadUrl = 'https://kns.cnki.net/kcms2/article/abstract?filename='
            + encodeURIComponent(result.fileName)
            + '&dbname=' + encodeURIComponent(result.dbName)
            + '&dbcode=' + encodeURIComponent(result.dbName)
            + '&v=pdf';
        }

        // Collect page info for debugging
        result._pageUrl = window.location.href;
        result._hasDownloadBtn = !!document.getElementById('pdfDown');
        result._bodySnippet = document.body?.innerHTML?.slice(0, 500) || '';

        return result;
      })()
    `;

    const detailResult = await win.webContents.executeJavaScript(detailScript);
    logger.info('[BrowserSearch:CNKI] Detail page extraction', {
      fileName: detailResult?.fileName ?? '',
      dbName: detailResult?.dbName ?? '',
      downloadUrl: detailResult?.downloadUrl?.slice(0, 100) ?? null,
      hasDownloadBtn: detailResult?._hasDownloadBtn ?? false,
      pageUrl: detailResult?._pageUrl?.slice(0, 100) ?? '',
    });

    // Step 6: Export session cookies for use in HTTP download
    const allCookies = await ses.cookies.get({ domain: 'cnki.net' });
    const cookieHeader = allCookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    logger.info('[BrowserSearch:CNKI] Exported cookies', {
      count: allCookies.length,
      preview: cookieHeader.slice(0, 100),
    });

    // Return all results with the download URL from the detail page
    return searchResults.map((r, i) => ({
      title: r.title,
      downloadUrl: i === 0 ? (detailResult?.downloadUrl ?? null) : null,
      detailUrl: r.detailUrl,
      metadata: {
        fileName: i === 0 ? (detailResult?.fileName ?? '') : '',
        dbName: i === 0 ? (detailResult?.dbName ?? '') : '',
        sessionCookies: i === 0 ? cookieHeader : '',
      },
    }));
  } catch (err) {
    logger.error('[BrowserSearch:CNKI] Error', undefined, { error: (err as Error).message });
    return [];
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

// ─── Wanfang search via BrowserWindow ───

async function searchWanfangInBrowser(
  sessionPartition: string,
  title: string,
  logger: Logger,
): Promise<BrowserSearchResult[]> {
  const ses = session.fromPartition(sessionPartition);
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);

  try {
    // Navigate to Wanfang search URL
    const searchUrl = `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(title)}&style=detail&f=D`;
    logger.info('[BrowserSearch:Wanfang] Navigating to search', { url: searchUrl.slice(0, 120) });

    await win.loadURL(searchUrl);

    // Wait for SPA to render results
    const waitScript = `
      new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
          attempts++;
          const noResult = document.querySelector('.no-result, .empty-result, .no-data');
          if (noResult && noResult.offsetParent !== null) {
            resolve({ status: 'no_data', text: noResult.textContent?.trim()?.slice(0, 100) });
            return;
          }
          // Check for rendered result items — look for any link to detail pages
          const detailLinks = document.querySelectorAll('a[href*="/detail/"], a[href*="d.wanfangdata.com.cn"]');
          if (detailLinks.length > 0) {
            resolve({ status: 'has_results', count: detailLinks.length, via: 'detail_links' });
            return;
          }
          // Check for titles in the result list
          const titles = document.querySelectorAll('.normal-list .title, .search-result .title, [class*="result-item"] .title');
          if (titles.length > 0) {
            resolve({ status: 'has_results', count: titles.length, via: 'titles' });
            return;
          }
          if (attempts > 30) {
            // Dump DOM info for debugging
            const body = document.body?.innerHTML || '';
            const allLinks = document.querySelectorAll('a[href]');
            const linkSamples = Array.from(allLinks).slice(0, 10).map(a => ({
              href: a.getAttribute('href')?.slice(0, 80),
              text: a.textContent?.trim()?.slice(0, 40),
              cls: a.className?.slice(0, 40),
            }));
            resolve({
              status: 'timeout',
              bodyLen: body.length,
              linkCount: allLinks.length,
              linkSamples,
              snippet: body.slice(0, 500),
            });
            return;
          }
          setTimeout(check, 500);
        };
        // SPA needs time to bootstrap
        setTimeout(check, 3000);
      })
    `;

    const waitResult = await win.webContents.executeJavaScript(waitScript);
    logger.info('[BrowserSearch:Wanfang] Wait result', { result: JSON.stringify(waitResult)?.slice(0, 500) });

    if (waitResult?.status === 'no_data') {
      return [];
    }

    // Even on timeout, try extraction — the page might have rendered partially
    // Extract results from the rendered DOM
    const extractScript = `
      (() => {
        const results = [];
        const seen = new Set();

        // Pattern 1: normal-list items with hidden IDs
        const hiddenIds = document.querySelectorAll('[class*="title-id"]');
        for (const span of hiddenIds) {
          const raw = span.textContent?.trim() || '';
          const underIdx = raw.indexOf('_');
          if (underIdx <= 0) continue;
          const type = raw.slice(0, underIdx);
          const id = raw.slice(underIdx + 1);
          if (!id || seen.has(id)) continue;
          seen.add(id);

          const container = span.closest('[class*="normal-list"], [class*="result-item"]') || span.parentElement?.parentElement;
          const titleEl = container?.querySelector('[class*="title"] a, a[class*="title"]');
          const title = titleEl?.textContent?.trim()?.replace(/<[^>]*>/g, '') || '';

          if (title && title.length > 4) {
            const pathMap = { periodical: 'periodical', thesis: 'thesis', conference: 'conference', perio: 'periodical', Periodical: 'periodical', Thesis: 'thesis', Conference: 'conference' };
            const pathSegment = pathMap[type] || 'periodical';
            results.push({ title, paperId: id, paperType: type, detailUrl: 'https://d.wanfangdata.com.cn/' + pathSegment + '/' + id });
          }
        }
        if (results.length > 0) return results;

        // Pattern 2: Links containing detail page URLs
        const allLinks = document.querySelectorAll('a[href]');
        for (const link of allLinks) {
          const href = link.getAttribute('href') || '';
          // Match d.wanfangdata.com.cn/type/id or /detail/type/id patterns
          const match = href.match(/(?:d\\.wanfangdata\\.com\\.cn|\\/(detail))\\/(periodical|thesis|conference)\\/([^?#/]+)/);
          if (!match) continue;
          const type = match[2];
          const id = match[3];
          if (!id || seen.has(id)) continue;
          seen.add(id);

          const title = link.textContent?.trim()?.replace(/<[^>]*>/g, '') || '';
          if (title && title.length > 4 && !title.includes('许可证') && !title.includes('备案') && !title.includes('版权')) {
            results.push({ title, paperId: id, paperType: type, detailUrl: 'https://d.wanfangdata.com.cn/' + type + '/' + id });
          }
        }
        if (results.length > 0) return results;

        // Pattern 3: Broadest — find any substantive links with Chinese text
        // Look for links whose parent has data attributes or specific classes
        const containers = document.querySelectorAll('[class*="normal-list"], [class*="paper-list"], [class*="result-item"], [class*="search-result"]');
        for (const container of containers) {
          const links = container.querySelectorAll('a[href]');
          for (const link of links) {
            const href = link.getAttribute('href') || '';
            const title = link.textContent?.trim() || '';
            // Check if link text looks like a paper title (has Chinese characters, reasonable length)
            if (title.length > 8 && /[\\u4e00-\\u9fff]/.test(title) && !seen.has(title)) {
              seen.add(title);
              // Try to extract ID from the href
              const idMatch = href.match(/\\/([a-zA-Z0-9_.-]+)(?:\\?|$)/);
              const typeMatch = href.match(/\\/(periodical|thesis|conference|perio)\\//);
              const paperId = idMatch?.[1] || '';
              const paperType = typeMatch?.[1] || 'periodical';
              if (paperId && paperId.length > 3) {
                results.push({
                  title,
                  paperId,
                  paperType,
                  detailUrl: href.startsWith('http') ? href : 'https://d.wanfangdata.com.cn/' + paperType + '/' + paperId,
                });
              }
            }
          }
        }

        return results;
      })()
    `;

    const rawResults = await win.webContents.executeJavaScript(extractScript);
    logger.info('[BrowserSearch:Wanfang] Extracted results', {
      count: rawResults?.length ?? 0,
      titles: (rawResults ?? []).slice(0, 3).map((r: any) => r.title?.slice(0, 40)),
    });

    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      // Debug: dump a sample of what's actually on the page
      const debugScript = `
        (() => {
          const links = Array.from(document.querySelectorAll('a[href]'));
          return {
            totalLinks: links.length,
            samples: links.slice(0, 15).map(a => ({
              href: (a.getAttribute('href') || '').slice(0, 100),
              text: (a.textContent || '').trim().slice(0, 60),
              cls: (a.className || '').slice(0, 50),
              parentCls: (a.parentElement?.className || '').slice(0, 50),
            })),
          };
        })()
      `;
      const debugInfo = await win.webContents.executeJavaScript(debugScript);
      logger.info('[BrowserSearch:Wanfang] Debug DOM dump', {
        totalLinks: debugInfo?.totalLinks,
        samples: JSON.stringify(debugInfo?.samples)?.slice(0, 1000),
      });
      return [];
    }

    // Export session cookies for HTTP download
    const allCookies = await ses.cookies.get({ domain: 'wanfangdata.com.cn' });
    const cookieHeader = allCookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    return rawResults.map((r: any) => ({
      title: r.title ?? '',
      downloadUrl: null,
      detailUrl: r.detailUrl ?? '',
      metadata: {
        paperId: r.paperId ?? '',
        paperType: r.paperType ?? '',
        sessionCookies: cookieHeader,
      },
    }));
  } catch (err) {
    logger.error('[BrowserSearch:Wanfang] Error', undefined, { error: (err as Error).message });
    return [];
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

// ─── Public: create the search function ───

export function createBrowserSearchFn(
  getInstitutionId: () => string | null,
  logger: Logger,
): BrowserSearchFn {
  return async (source, title, _options) => {
    const institutionId = getInstitutionId();
    if (!institutionId) {
      logger.warn(`[BrowserSearch] No institution ID, cannot perform ${source} browser search`);
      return [];
    }

    const partition = `persist:institutional-${institutionId}`;

    if (source === 'cnki') {
      return searchCnkiInBrowser(partition, title, logger);
    } else if (source === 'wanfang') {
      return searchWanfangInBrowser(partition, title, logger);
    }

    return [];
  };
}

// ─── Helpers ───

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForNavigation(
  win: BrowserWindow,
  predicate: (url: string) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: boolean) => {
      if (!done) {
        done = true;
        win.webContents.removeListener('did-navigate', onNav);
        win.webContents.removeListener('did-navigate-in-page', onNav);
        resolve(result);
      }
    };
    const onNav = (_e: Electron.Event, url: string) => {
      if (predicate(url)) finish(true);
    };
    win.webContents.on('did-navigate', onNav);
    win.webContents.on('did-navigate-in-page', onNav);
    setTimeout(() => finish(false), timeoutMs);
  });
}
