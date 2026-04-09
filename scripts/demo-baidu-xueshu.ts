/**
 * 百度学术搜索 demo — puppeteer-core + 系统 Chrome
 *
 * 不下载额外浏览器，复用系统已安装的 Chrome。
 * 正式集成时用 Electron BrowserWindow 替换（零依赖）。
 *
 * 用法：npx tsx scripts/demo-baidu-xueshu.ts
 */

import puppeteer, { type Browser } from 'puppeteer-core';
import { join } from 'path';
import { tmpdir } from 'os';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// 持久化用户数据目录 → 验证码只需完成一次
const USER_DATA_DIR = join(tmpdir(), 'abyssal-baidu-xueshu-profile');

// ── 类型 ──

interface ScholarResult {
  title: string;
  authors: string[];
  journal: string | null;
  year: number | null;
  abstract: string | null;
  doi: string | null;
  citeCount: number | null;
  url: string | null;
}

// ── 百度学术搜索 ──

// 复用浏览器实例，会话内 cookie 持久化
let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  sharedBrowser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,  // 非 headless，首次验证码需要用户交互
    args: [
      '--disable-blink-features=AutomationControlled',
      `--user-data-dir=${USER_DATA_DIR}`,
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  return sharedBrowser;
}

async function searchBaiduXueshu(query: string, maxResults = 5): Promise<ScholarResult[]> {
  const browser = await getBrowser();

  // 用新标签页而不是新浏览器实例 → cookie 共享
  const page = await browser.newPage();

  try {
    const url = `https://xueshu.baidu.com/s?wd=${encodeURIComponent(query)}&ie=utf-8`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // 等待结果（兼容新旧版 UI）
    const status = await page.evaluate(`
      new Promise(function(resolve) {
        var attempts = 0;
        function check() {
          attempts++;
          if (document.title.includes('安全验证') || document.title.includes('验证码')) {
            resolve({ status: 'captcha' });
            return;
          }
          // 旧版: .sc_content  新版(ndscholar): .result with .paper-info
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
            resolve({ status: 'timeout' });
            return;
          }
          setTimeout(check, 500);
        }
        check();
      })
    `) as { status: string; ui?: string; count?: number };

    console.log(`    页面状态: ${JSON.stringify(status)}`);

    // 遇到验证码 → 等待用户完成，然后重新导航
    if (status.status === 'captcha') {
      console.log('    ⚠ 请在弹出的浏览器中完成安全验证...');

      // 等待页面 URL 变化（验证完成后会跳转）
      try {
        await page.waitForNavigation({ timeout: 60000, waitUntil: 'domcontentloaded' });
      } catch {
        // 可能已经导航了
      }

      console.log('    验证已完成，重新搜索...');
      // 短暂等待后重新导航到搜索页
      await new Promise(r => setTimeout(r, 1000));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // 再次等待结果
      const retryStatus = await page.evaluate(`
        new Promise(function(resolve) {
          var attempts = 0;
          function check() {
            attempts++;
            var results = document.querySelectorAll('.sc_content');
            if (results.length > 0) {
              resolve({ status: 'ok', count: results.length });
              return;
            }
            if (attempts > 20) { resolve({ status: 'timeout' }); return; }
            setTimeout(check, 500);
          }
          check();
        })
      `) as { status: string; count?: number };

      console.log(`    重试状态: ${JSON.stringify(retryStatus)}`);
      if (retryStatus.status !== 'ok') return [];

    } else if (status.status === 'timeout') {
      // 新版百度学术 (ndscholar) 使用不同的 DOM 结构，探测
      const debugInfo = await page.evaluate(`
        (function() {
          var url = location.href;
          var isNewUI = url.includes('ndscholar');

          // 探测候选选择器
          var selectors = [
            '.sc_content', '.result', '.result-item', '.paper-item',
            '[class*="result"]', '[class*="paper"]', '[class*="item"]',
            '.search-result', '.list-item', 'article',
          ];
          var found = {};
          for (var i = 0; i < selectors.length; i++) {
            var count = document.querySelectorAll(selectors[i]).length;
            if (count > 0) found[selectors[i]] = count;
          }

          // 取第一个 .result 内部结构
          var firstResult = document.querySelector('.result');
          var innerStructure = null;
          if (firstResult) {
            var children = firstResult.querySelectorAll('*');
            var classMap = {};
            for (var j = 0; j < Math.min(children.length, 80); j++) {
              var cls = children[j].className;
              var tag = children[j].tagName;
              if (cls && typeof cls === 'string') classMap[tag + '.' + cls.split(' ')[0]] = (children[j].textContent || '').slice(0, 60);
            }
            innerStructure = classMap;
          }

          var textSample = document.body.innerText.slice(0, 500);

          return {
            title: document.title,
            url: url,
            isNewUI: isNewUI,
            foundSelectors: found,
            innerStructure: innerStructure,
            textSample: textSample,
          };
        })()
      `) as any;
      console.log(`    [DEBUG] URL: ${debugInfo.url}`);
      console.log(`    [DEBUG] 新版UI: ${debugInfo.isNewUI}`);
      console.log(`    [DEBUG] 找到的选择器:`, debugInfo.foundSelectors);
      if (debugInfo.innerStructure) {
        console.log(`    [DEBUG] .result 内部结构:`);
        for (const [k, v] of Object.entries(debugInfo.innerStructure)) {
          console.log(`      ${k}: "${(v as string).slice(0, 80)}"`);
        }
      }
      return [];
    } else if (status.status !== 'ok') {
      return [];
    }

    // 提取结果（兼容新旧版 UI）
    const uiVersion = (status as any).ui ?? 'new';
    const extractScript = `
      (function() {
        var items = [];
        var max = ${maxResults};
        var isNew = ${uiVersion === 'new'};

        if (isNew) {
          // ── 新版 ndscholar UI ──
          var blocks = document.querySelectorAll('.result');
          for (var i = 0; i < Math.min(blocks.length, max); i++) {
            var block = blocks[i];

            // 标题
            var titleEl = block.querySelector('h3 a') || block.querySelector('a.atomic-line-clamp-3');
            var title = titleEl ? titleEl.textContent.trim() : '';
            if (!title) continue;
            var paperUrl = titleEl ? titleEl.href : null;

            // paper-info: "张粒子，唐成鹏，刘方，... - 《中国电机工程学报》 - 被引量：0 - 2021年"
            var infoEl = block.querySelector('.paper-info');
            var infoText = infoEl ? infoEl.textContent.trim() : '';
            var parts = infoText.split(/\\s+-\\s+/);

            // 作者 (第一段)
            var authors = [];
            if (parts[0]) {
              authors = parts[0].split(/[，,]/)
                .map(function(a) { return a.replace(/\\.\\.\\.$/,'').trim(); })
                .filter(function(a) { return a.length >= 2; });
            }

            // 期刊 《...》
            var journal = null;
            var jMatch = infoText.match(/《([^》]+)》/);
            if (jMatch) journal = jMatch[1];

            // 年份
            var year = null;
            var ym = infoText.match(/((?:19|20)\\d{2})年/);
            if (ym) year = parseInt(ym[1]);

            // 被引量
            var citeCount = null;
            var cm = infoText.match(/被引量[：:]\\s*(\\d+)/);
            if (cm) citeCount = parseInt(cm[1]);

            // 摘要
            var absEl = block.querySelector('.paper-abstract');
            var abstract = absEl ? absEl.textContent.trim() : null;

            // DOI
            var doi = null;
            var dm = block.innerHTML.match(/DOI[:：]\\s*(10\\.\\d{4,}\\/[^\\s<"]+)/i);
            if (dm) doi = dm[1];

            items.push({ title: title, authors: authors, journal: journal, year: year, abstract: abstract, doi: doi, citeCount: citeCount, url: paperUrl });
          }
        } else {
          // ── 旧版 UI ──
          var blocks = document.querySelectorAll('.sc_content');
          for (var i = 0; i < Math.min(blocks.length, max); i++) {
            var block = blocks[i];
            var titleEl = block.querySelector('h3.t a');
            var title = titleEl ? titleEl.textContent.trim() : '';
            if (!title) continue;
            var paperUrl = titleEl ? titleEl.href : null;

            var authors = [];
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

            items.push({ title: title, authors: authors, journal: journal, year: year, abstract: abstract, doi: null, citeCount: null, url: paperUrl });
          }
        }
        return items;
      })()
    `;
    const results = await page.evaluate(extractScript) as ScholarResult[];

    return results;

  } finally {
    await page.close();  // 只关标签页，不关浏览器
  }
}

// ── 打印 ──

function printResult(i: number, r: ScholarResult) {
  console.log(`  [${i + 1}] ${r.title}`);
  if (r.authors.length) console.log(`      作者: ${r.authors.slice(0, 6).join(', ')}`);
  if (r.journal) console.log(`      期刊: ${r.journal}`);
  if (r.year) console.log(`      年份: ${r.year}`);
  if (r.doi) console.log(`      DOI:  ${r.doi}`);
  if (r.citeCount != null) console.log(`      被引: ${r.citeCount}`);
  if (r.abstract) console.log(`      摘要: ${r.abstract.slice(0, 120)}...`);
}

// ── 测试用例 ──

const testCases = [
  { label: '论文① (标题关键词)', query: '多智能体强化学习 电力现货市场定价机制 结合理论与仿真' },
  { label: '论文② (主题关键词)', query: '绿证 碳排放权交易 电力市场 协同减碳效应 仿真' },
  { label: '论文③ (标题后半段)', query: '日前电碳耦合市场运行策略' },
  { label: '论文④ (3个核心概念)', query: '动态碳排放强度 电碳市场耦合 建模方法' },
];

// ── main ──

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  百度学术搜索 Demo — puppeteer-core + 系统 Chrome      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  for (const tc of testCases) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${tc.label}`);
    console.log(`  查询: "${tc.query}"`);

    const t0 = Date.now();
    try {
      const results = await searchBaiduXueshu(tc.query, 3);
      const elapsed = Date.now() - t0;

      if (results.length === 0) {
        console.log(`  ⚠ 无结果 (${elapsed}ms)`);
      } else {
        console.log(`  ✅ ${results.length} 条结果 (${elapsed}ms)\n`);
        for (let i = 0; i < results.length; i++) printResult(i, results[i]);
      }
    } catch (err) {
      console.log(`  ❌ ${(err as Error).message}`);
    }

    // 礼貌间隔
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('测试完成');

  // 关闭浏览器
  if (sharedBrowser?.connected) await sharedBrowser.close();
}

main().catch((err) => {
  console.error('致命错误:', err);
  process.exit(1);
});
