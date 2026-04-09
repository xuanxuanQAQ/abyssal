/**
 * 百度学术元数据搜索 — Electron BrowserWindow 实现
 *
 * 使用隐藏的 BrowserWindow 访问百度学术，提取结构化元数据。
 * 全自动流程，仅在遇到验证码时临时显示窗口。
 * Cookie 通过 session partition 持久化，验证码只需完成一次。
 */

import { BrowserWindow, session } from 'electron';
import type { Logger } from '../core/infra/logger';

// ─── 类型 ───

export interface BaiduXueshuResult {
  title: string;
  authors: string[];
  journal: string | null;
  year: number | null;
  abstract: string | null;
  doi: string | null;
  citeCount: number | null;
  url: string | null;
}

export type BaiduXueshuSearchFn = (
  query: string,
  limit?: number,
) => Promise<BaiduXueshuResult[]>;

// ─── 常量 ───

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SESSION_PARTITION = 'persist:baidu-xueshu';

// ─── 页面内 JavaScript（纯字符串，避免 esbuild 注入 __name） ───

const WAIT_SCRIPT = `
  new Promise(function(resolve) {
    var attempts = 0;
    function check() {
      attempts++;
      if (document.title.includes('安全验证') || document.title.includes('验证码')) {
        resolve({ status: 'captcha' });
        return;
      }
      var oldResults = document.querySelectorAll('.sc_content');
      var newResults = document.querySelectorAll('.result .paper-info');
      if (oldResults.length > 0) {
        resolve({ status: 'ok', ui: 'old', count: oldResults.length });
        return;
      }
      if (newResults.length > 0) {
        resolve({ status: 'ok', ui: 'new', count: newResults.length });
        return;
      }
      if (attempts > 20) {
        resolve({ status: 'timeout', title: document.title });
        return;
      }
      setTimeout(check, 500);
    }
    check();
  })
`;

function buildExtractScript(maxResults: number, ui: string): string {
  return `
    (function() {
      var items = [];
      var max = ${maxResults};
      var isNew = ${ui === 'new'};

      if (isNew) {
        var blocks = document.querySelectorAll('.result');
        for (var i = 0; i < Math.min(blocks.length, max); i++) {
          var block = blocks[i];
          var titleEl = block.querySelector('h3 a') || block.querySelector('a.atomic-line-clamp-3');
          var title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) continue;
          var paperUrl = titleEl ? titleEl.href : null;

          var infoEl = block.querySelector('.paper-info');
          var infoText = infoEl ? infoEl.textContent.trim() : '';
          var parts = infoText.split(/\\s+-\\s+/);

          var authors = [];
          if (parts[0]) {
            authors = parts[0].split(/[，,]/)
              .map(function(a) { return a.replace(/\\.\\.\\.$/,'').trim(); })
              .filter(function(a) { return a.length >= 2; });
          }

          var journal = null;
          var jMatch = infoText.match(/《([^》]+)》/);
          if (jMatch) journal = jMatch[1];

          var year = null;
          var ym = infoText.match(/((?:19|20)\\d{2})年/);
          if (ym) year = parseInt(ym[1]);

          var citeCount = null;
          var cm = infoText.match(/被引量[：:]\\s*(\\d+)/);
          if (cm) citeCount = parseInt(cm[1]);

          var absEl = block.querySelector('.paper-abstract');
          var abstract = absEl ? absEl.textContent.trim() : null;

          var doi = null;
          var dm = block.innerHTML.match(/DOI[:：]\\s*(10\\.\\d{4,}\\/[^\\s<"]+)/i);
          if (dm) doi = dm[1];

          items.push({
            title: title, authors: authors, journal: journal,
            year: year, abstract: abstract, doi: doi,
            citeCount: citeCount, url: paperUrl
          });
        }
      } else {
        var blocks = document.querySelectorAll('.sc_content');
        for (var i = 0; i < Math.min(blocks.length, max); i++) {
          var block = blocks[i];
          var titleEl = block.querySelector('h3.t a');
          var title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) continue;
          var paperUrl = titleEl ? titleEl.href : null;

          var journal = null;
          var year = null;
          var infoEl = block.querySelector('.sc_info');
          if (infoEl) {
            var jMatch = infoEl.textContent.match(/《([^》]+)》/);
            if (jMatch) journal = jMatch[1];
            var ym = infoEl.textContent.match(/((?:19|20)\\d{2})/);
            if (ym) year = parseInt(ym[1]);
          }

          var absEl = block.querySelector('.c_abstract');
          var abstract = absEl ? absEl.textContent.trim() : null;

          items.push({
            title: title, authors: [], journal: journal,
            year: year, abstract: abstract, doi: null,
            citeCount: null, url: paperUrl
          });
        }
      }
      return items;
    })()
  `;
}

// ─── 搜索实现 ───

async function searchBaiduXueshuImpl(
  query: string,
  logger: Logger,
  limit: number = 10,
): Promise<BaiduXueshuResult[]> {
  const ses = session.fromPartition(SESSION_PARTITION);
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);

  try {
    const url = `https://xueshu.baidu.com/s?wd=${encodeURIComponent(query)}&ie=utf-8`;
    logger.info('[BaiduXueshu] navigating', { query: query.slice(0, 60) });
    await win.loadURL(url);

    // 等待结果
    const status: {
      status: string;
      ui: string | undefined;
      count: number | undefined;
      title: string | undefined;
    } = await win.webContents.executeJavaScript(WAIT_SCRIPT);

    logger.info('[BaiduXueshu] page status', { status: status.status, ui: status.ui, count: status.count });

    // 验证码处理
    if (status.status === 'captcha') {
      logger.info('[BaiduXueshu] CAPTCHA detected, showing window');
      win.show();
      win.focus();
      win.setTitle('百度学术 — 请完成安全验证');

      // 等待验证完成（页面导航）
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };

        const onNav = () => {
          if (!win.isDestroyed()) {
            win.webContents.executeJavaScript('document.title').then((title: string) => {
              if (!title.includes('安全验证') && !title.includes('验证码')) {
                win.hide();
                finish();
              }
            }).catch(finish);
          }
        };
        win.webContents.on('did-navigate', onNav);
        win.webContents.on('did-navigate-in-page', onNav);
        win.on('closed', finish);
        setTimeout(finish, 60_000); // 60s 超时
      });

      // 验证完成，重新导航
      logger.info('[BaiduXueshu] CAPTCHA resolved, retrying search');
      await delay(1000);
      await win.loadURL(url);

      // 重新等待
      const retry = await win.webContents.executeJavaScript(WAIT_SCRIPT) as {
        status: string; ui?: string; count?: number;
      };
      if (retry.status !== 'ok') {
        logger.warn('[BaiduXueshu] No results after CAPTCHA', { status: retry.status });
        return [];
      }
      status.ui = retry.ui;
    }

    if (status.status === 'timeout') {
      logger.warn('[BaiduXueshu] Timeout waiting for results', { title: status.title });
      return [];
    }

    // 提取结果
    const uiVersion = status.ui ?? 'new';
    const results = await win.webContents.executeJavaScript(
      buildExtractScript(limit, uiVersion),
    ) as BaiduXueshuResult[];

    logger.info('[BaiduXueshu] extracted', { count: results?.length ?? 0 });
    return results ?? [];

  } catch (err) {
    logger.error('[BaiduXueshu] search error', undefined, { error: (err as Error).message });
    return [];
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── 工厂函数 ───

export function createBaiduXueshuSearchFn(logger: Logger): BaiduXueshuSearchFn {
  return (query, limit) => searchBaiduXueshuImpl(query, logger, limit);
}
