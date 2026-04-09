/**
 * 百度学术搜索 demo — 使用 Electron BrowserWindow
 *
 * 利用项目自带的 Chromium，隐藏窗口全自动爬取元数据。
 *
 * 用法：npx electron scripts/demo-baidu-electron.cjs
 */

const { app, BrowserWindow, session } = require('electron');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── 百度学术搜索 ──

async function searchBaiduXueshu(query, maxResults = 5) {
  const ses = session.fromPartition('persist:baidu-xueshu-demo');
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
    console.log(`    导航: ${url.slice(0, 100)}`);
    await win.loadURL(url);

    // 等待搜索结果渲染
    const waitResult = await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
          attempts++;
          if (document.title.includes('安全验证') || document.title.includes('验证码')) {
            resolve({ status: 'captcha' });
            return;
          }
          const results = document.querySelectorAll('.sc_content');
          if (results.length > 0) {
            resolve({ status: 'ok', count: results.length });
            return;
          }
          if (document.querySelector('.no-result') || document.body.textContent.includes('没有找到')) {
            resolve({ status: 'no_results' });
            return;
          }
          if (attempts > 20) {
            resolve({ status: 'timeout', title: document.title, bodyLen: document.body.innerHTML.length });
            return;
          }
          setTimeout(check, 500);
        };
        check();
      })
    `);

    console.log(`    页面状态: ${JSON.stringify(waitResult)}`);

    if (waitResult.status === 'captcha') {
      console.log('    ⚠ 遇到安全验证，显示窗口等待用户完成...');
      win.show();
      win.focus();
      win.setTitle('百度学术 — 请完成安全验证');

      await new Promise((resolve) => {
        let done = false;
        const check = () => {
          if (done || win.isDestroyed()) return;
          win.webContents.executeJavaScript('document.title').then(title => {
            if (!title.includes('安全验证') && !title.includes('验证码')) {
              done = true;
              win.hide();
              resolve();
            } else {
              setTimeout(check, 1000);
            }
          }).catch(() => { done = true; resolve(); });
        };
        setTimeout(check, 1000);
        setTimeout(() => { done = true; resolve(); }, 60000);
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    if (waitResult.status === 'no_results' || waitResult.status === 'timeout') {
      return [];
    }

    // 提取搜索结果元数据
    const results = await win.webContents.executeJavaScript(`
      (() => {
        const items = [];
        const blocks = document.querySelectorAll('.sc_content');

        for (let i = 0; i < Math.min(blocks.length, ${maxResults}); i++) {
          const block = blocks[i];

          // 标题
          const titleEl = block.querySelector('h3.t a');
          const title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) continue;
          const paperUrl = titleEl ? titleEl.href : '';

          // 作者、期刊、年份
          let authors = [];
          let journal = null;
          let year = null;

          const infoEl = block.querySelector('.sc_info');
          if (infoEl) {
            // 作者链接
            const authorLinks = infoEl.querySelectorAll('a[data-click*="author"], a[href*="author"]');
            if (authorLinks.length > 0) {
              authors = Array.from(authorLinks).map(a => a.textContent.trim()).filter(Boolean);
            }
            // fallback: 第一个 span
            if (authors.length === 0) {
              const spans = infoEl.querySelectorAll('span');
              for (const span of spans) {
                const text = span.textContent.trim();
                if ((text.includes(',') || text.includes('，')) && !text.match(/\\d{4}/) && authors.length === 0) {
                  authors = text.split(/[,，]/).map(a => a.trim()).filter(Boolean);
                }
              }
            }

            // 期刊
            const journalEl = infoEl.querySelector('a[data-channel="journalName"], a[href*="journal"]');
            if (journalEl) journal = journalEl.textContent.trim();
            if (!journal) {
              const jMatch = infoEl.textContent.match(/《([^》]+)》/);
              if (jMatch) journal = jMatch[1];
            }

            // 年份
            const yearMatch = infoEl.textContent.match(/((?:19|20)\\d{2})/);
            if (yearMatch) year = parseInt(yearMatch[1]);
          }

          // 摘要
          const absEl = block.querySelector('.c_abstract');
          const abstract = absEl ? absEl.textContent.trim().replace(/^摘要[:：]\\s*/, '') : null;

          // 被引数
          let citeCount = null;
          const citeEl = block.querySelector('.sc_cite_cont');
          if (citeEl) {
            const cm = citeEl.textContent.match(/(\\d+)/);
            if (cm) citeCount = parseInt(cm[1]);
          }

          // DOI
          let doi = null;
          const dm = block.innerHTML.match(/DOI[:：]\\s*(10\\.\\d{4,}\\/[^\\s<"]+)/i);
          if (dm) doi = dm[1];

          items.push({ title, authors, journal, year, abstract, doi, citeCount, url: paperUrl });
        }
        return items;
      })()
    `);

    return results;

  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

// ── 测试用例 ──

const testCases = [
  { label: '论文① (标题关键词)', query: '多智能体强化学习 电力现货市场定价机制 结合理论与仿真' },
  { label: '论文② (主题关键词)', query: '绿证 碳排放权交易 电力市场 协同减碳效应 仿真' },
  { label: '论文③ (标题后半段)', query: '日前电碳耦合市场运行策略' },
  { label: '论文④ (3个核心概念)', query: '动态碳排放强度 电碳市场耦合 建模方法' },
];

// ── main ──

app.whenReady().then(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║    百度学术搜索 Demo — Electron BrowserWindow 爬取     ║');
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
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          console.log(`  [${i + 1}] ${r.title}`);
          if (r.authors?.length) console.log(`      作者: ${r.authors.slice(0, 5).join(', ')}`);
          if (r.journal) console.log(`      期刊: ${r.journal}`);
          if (r.year) console.log(`      年份: ${r.year}`);
          if (r.doi) console.log(`      DOI:  ${r.doi}`);
          if (r.citeCount != null) console.log(`      被引: ${r.citeCount}`);
          if (r.abstract) console.log(`      摘要: ${r.abstract.slice(0, 120)}...`);
        }
      }
    } catch (err) {
      console.log(`  ❌ ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('测试完成');
  app.quit();
});
