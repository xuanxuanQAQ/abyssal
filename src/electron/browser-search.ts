/**
 * BrowserWindow-based search for CNKI and Wanfang.
 *
 * Both platforms have anti-automation measures that prevent fully automated
 * PDF download:
 * - CNKI: bar.cnki.net ordering system requires full browser JS context
 * - Wanfang: SPA detects Electron and refuses to render
 *
 * Strategy (Plan A — Semi-automated):
 * - CNKI: Automated search + detail navigation, then show window for user to
 *   click the PDF download button. Intercept file via `will-download`.
 * - Wanfang: Show window at search URL immediately for user to find paper and
 *   download. Intercept file via `will-download`.
 */

import { BrowserWindow, session, app } from 'electron';
import type { Logger } from '../core/infra/logger';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';

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

// ─── Hint preferences (persist "don't show again" per source) ───

interface HintPrefs {
  /** Sources the user has dismissed hints for */
  dismissed: string[];
}

function getHintPrefsPath(): string {
  return join(app.getPath('userData'), 'download-hint-prefs.json');
}

function loadHintPrefs(): HintPrefs {
  try {
    const p = getHintPrefsPath();
    if (!existsSync(p)) return { dismissed: [] };
    return JSON.parse(readFileSync(p, 'utf-8')) as HintPrefs;
  } catch {
    return { dismissed: [] };
  }
}

function saveHintPrefs(prefs: HintPrefs): void {
  try {
    writeFileSync(getHintPrefsPath(), JSON.stringify(prefs, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

function isHintDismissed(source: string): boolean {
  return loadHintPrefs().dismissed.includes(source);
}

function dismissHint(source: string): void {
  const prefs = loadHintPrefs();
  if (!prefs.dismissed.includes(source)) {
    prefs.dismissed.push(source);
    saveHintPrefs(prefs);
  }
}

/**
 * Inject a floating hint overlay into the page.
 * Shows instructions on the right side with a dismiss button and
 * "don't show again" checkbox.
 */
async function injectHintOverlay(
  win: BrowserWindow,
  source: string,
  message: string,
): Promise<void> {
  if (isHintDismissed(source)) return;

  // The overlay is injected as raw HTML/CSS via executeJavaScript.
  // It listens for dismiss + checkbox and posts a message back via console.log
  // which we intercept via webContents console-message event.
  const overlayScript = `
    (() => {
      if (document.getElementById('__abyssal_hint')) return;

      const overlay = document.createElement('div');
      overlay.id = '__abyssal_hint';
      overlay.innerHTML = \`
        <div style="
          position: fixed; top: 16px; right: 16px; z-index: 2147483647;
          width: 320px; padding: 16px 20px;
          background: #1a1a2e; color: #e0e0e0;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          font-family: -apple-system, 'Microsoft YaHei', 'Segoe UI', sans-serif;
          font-size: 13px; line-height: 1.6;
          transition: opacity 0.3s ease, transform 0.3s ease;
          animation: __abyssal_slideIn 0.35s ease;
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span style="font-size:14px; font-weight:600; color:#7c9dff;">\u{1F4CE} \u64CD\u4F5C\u63D0\u793A</span>
            <button id="__abyssal_hint_close" style="
              background:none; border:none; color:#888; cursor:pointer;
              font-size:18px; padding:0 2px; line-height:1;
            " title="\u5173\u95ED">&times;</button>
          </div>
          <div style="margin-bottom:12px; color:#ccc;">
            ${message.replace(/'/g, "\\'")}
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; color:#999; font-size:12px;">
            <input type="checkbox" id="__abyssal_hint_noshow" style="
              width:14px; height:14px; cursor:pointer; accent-color:#7c9dff;
            ">
            \u4E0B\u6B21\u4E0D\u518D\u63D0\u793A
          </label>
        </div>
        <style>
          @keyframes __abyssal_slideIn {
            from { opacity: 0; transform: translateX(40px); }
            to   { opacity: 1; transform: translateX(0); }
          }
        </style>
      \`;
      document.body.appendChild(overlay);

      const closeBtn = document.getElementById('__abyssal_hint_close');
      const checkbox = document.getElementById('__abyssal_hint_noshow');

      function dismiss() {
        overlay.style.opacity = '0';
        overlay.style.transform = 'translateX(40px)';
        setTimeout(() => overlay.remove(), 300);
        if (checkbox && checkbox.checked) {
          console.log('__abyssal_dismiss_hint__:${source}');
        }
      }

      if (closeBtn) closeBtn.addEventListener('click', dismiss);
    })()
  `;

  // Listen for the dismiss signal from the injected script
  const onConsoleMessage = (_e: Electron.Event, _level: number, msg: string) => {
    if (msg === `__abyssal_dismiss_hint__:${source}`) {
      dismissHint(source);
      win.webContents.removeListener('console-message', onConsoleMessage);
    }
  };
  win.webContents.on('console-message', onConsoleMessage);

  // Inject now, and re-inject on navigation (page may reload)
  const doInject = () => {
    if (!win.isDestroyed()) {
      win.webContents.executeJavaScript(overlayScript).catch(() => {});
    }
  };
  doInject();
  win.webContents.on('did-finish-load', doInject);
  win.webContents.on('did-navigate-in-page', doInject);
}

// ─── Semi-automated download: show window to user, intercept via will-download ───

/**
 * Show the BrowserWindow to the user and wait for them to manually trigger a
 * PDF download. Intercepts the file via the session-level `will-download` event.
 *
 * Returns the path to the downloaded temp file, or null on timeout / user closing
 * the window.
 */
async function waitForUserDownload(
  ses: Electron.Session,
  win: BrowserWindow,
  windowTitle: string,
  logger: Logger,
  options?: {
    timeoutMs?: number;
    /** Source identifier for hint overlay (e.g. 'cnki', 'wanfang') */
    hintSource?: string;
    /** Hint message shown in the floating overlay */
    hintMessage?: string;
  },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const savePath = join(tmpdir(), `user-dl-${randomBytes(8).toString('hex')}.pdf`);

  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const popups: BrowserWindow[] = [];

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      ses.removeAllListeners('will-download');
      win.removeAllListeners('closed');
      // Close any popup windows
      for (const p of popups) { if (!p.isDestroyed()) p.close(); }
      // Hide / close the main window (don't destroy if already destroyed)
      if (!win.isDestroyed()) {
        win.hide();
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      logger.warn('[BrowserSearch] User download timeout', { timeoutMs });
      finish(null);
    }, timeoutMs);

    // If user closes the window, treat as cancellation
    win.on('closed', () => finish(null));

    // Intercept ANY download triggered in this session (main window or popups)
    ses.on('will-download', (_event, item) => {
      logger.info('[BrowserSearch] Download started (user-triggered)', {
        filename: item.getFilename(),
        mime: item.getMimeType(),
        totalBytes: item.getTotalBytes(),
      });
      item.setSavePath(savePath);
      item.on('done', (_e, state) => {
        if (state === 'completed') {
          logger.info('[BrowserSearch] Download complete', {
            path: savePath,
            bytes: item.getReceivedBytes(),
          });
          finish(savePath);
        } else {
          logger.warn('[BrowserSearch] Download ended with state', { state });
          finish(null);
        }
      });
    });

    // Allow popups (download pages may open in new windows) — show them to user
    win.webContents.setWindowOpenHandler(({ url }) => {
      logger.info('[BrowserSearch] Allowing popup', { url: url.slice(0, 120) });
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: true,
          width: 1280,
          height: 800,
          webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true },
        },
      };
    });
    win.webContents.on('did-create-window', (newWin) => {
      popups.push(newWin);
      newWin.webContents.setUserAgent(CHROME_UA);
    });

    // Show the window to the user
    win.setTitle(windowTitle);
    win.show();
    win.focus();

    // Inject floating hint overlay (respects "don't show again" preference)
    if (options?.hintSource && options?.hintMessage) {
      injectHintOverlay(win, options.hintSource, options.hintMessage).catch(() => {});
    }
  });
}

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

    // Step 6: Export session cookies for use in HTTP download fallback
    const allCookies = await ses.cookies.get({ domain: 'cnki.net' });
    const cookieHeader = allCookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    logger.info('[BrowserSearch:CNKI] Exported cookies', {
      count: allCookies.length,
      preview: cookieHeader.slice(0, 100),
    });

    // Step 7: Semi-automated download — show window to user for manual PDF download
    // CNKI's bar.cnki.net ordering system can't be automated; user clicks the button.
    let downloadedPath: string | null = null;
    logger.info('[BrowserSearch:CNKI] Showing window for user to download PDF');
    downloadedPath = await waitForUserDownload(
      ses, win,
      'CNKI — 请点击「PDF下载」按钮，下载完成后窗口将自动关闭',
      logger,
      {
        timeoutMs: 120_000,
        hintSource: 'cnki',
        hintMessage: '请在页面上找到并点击「PDF下载」按钮。<br>下载开始后窗口将自动关闭，文件会被自动导入。',
      },
    );

    if (downloadedPath) {
      logger.info('[BrowserSearch:CNKI] User download succeeded', { path: downloadedPath });
    } else {
      logger.info('[BrowserSearch:CNKI] User download not completed (timeout or cancelled)');
    }

    // Return all results with the download URL from the detail page
    return searchResults.map((r, i) => ({
      title: r.title,
      downloadUrl: i === 0 ? (detailResult?.downloadUrl ?? null) : null,
      detailUrl: r.detailUrl,
      metadata: {
        fileName: i === 0 ? (detailResult?.fileName ?? '') : '',
        dbName: i === 0 ? (detailResult?.dbName ?? '') : '',
        sessionCookies: i === 0 ? cookieHeader : '',
        ...(i === 0 && downloadedPath ? { downloadedTempPath: downloadedPath } : {}),
      },
    }));
  } catch (err) {
    logger.error('[BrowserSearch:CNKI] Error', undefined, { error: (err as Error).message });
    return [];
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

// ─── Wanfang search via BrowserWindow (semi-automated) ───

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
    // Navigate to Wanfang search page with the title as query
    const searchUrl = `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(title)}&style=detail&f=D`;
    logger.info('[BrowserSearch:Wanfang] Navigating to search', { url: searchUrl.slice(0, 120) });

    await win.loadURL(searchUrl);
    // Give the SPA a moment to start rendering before showing to user
    await delay(2000);

    // Semi-automated: show window to user, let them find the paper and click download
    // Wanfang's SPA detects Electron and won't render for automated extraction,
    // but it works fine when the user interacts with the visible window.
    logger.info('[BrowserSearch:Wanfang] Showing window for user to search and download');
    const downloadedPath = await waitForUserDownload(
      ses, win,
      '万方 — 请找到论文并点击下载PDF，下载完成后窗口将自动关闭',
      logger,
      {
        timeoutMs: 120_000,
        hintSource: 'wanfang',
        hintMessage: '请在搜索结果中找到目标论文，点击进入详情页后下载PDF。<br>下载开始后窗口将自动关闭，文件会被自动导入。',
      },
    );

    // Export session cookies (for metadata)
    const allCookies = await ses.cookies.get({ domain: 'wanfangdata.com.cn' });
    const cookieHeader = allCookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const currentUrl = win.isDestroyed() ? searchUrl : win.webContents.getURL();

    if (downloadedPath) {
      logger.info('[BrowserSearch:Wanfang] User download succeeded', { path: downloadedPath });
      return [{
        title,
        downloadUrl: null,
        detailUrl: currentUrl,
        metadata: {
          paperId: '',
          paperType: '',
          sessionCookies: cookieHeader,
          downloadedTempPath: downloadedPath,
        },
      }];
    }

    logger.info('[BrowserSearch:Wanfang] User download not completed (timeout or cancelled)');
    return [];
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
