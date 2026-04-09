/**
 * Google Scholar 搜索 demo（通过 SerpAPI）
 *
 * 验证 SerpAPI google_scholar engine 对中文论文的覆盖度和元数据质量。
 * 需要 SerpAPI key：https://serpapi.com（免费 100 次/月）
 *
 * 用法：
 *   SERPAPI_KEY=xxx npx tsx scripts/demo-scholar-search.ts
 *
 * 如果没有 key，会用 Tavily advanced search 作为对照。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型 ──

interface ScholarResult {
  title: string;
  authors: string[];
  journal: string | null;
  year: number | null;
  citedBy: number | null;
  snippet: string | null;
  link: string | null;
  source: string;
}

// ═══════════════════════════════════════════════════════
//  SerpAPI Google Scholar
// ═══════════════════════════════════════════════════════

async function searchGoogleScholar(apiKey: string, query: string, limit = 5): Promise<ScholarResult[]> {
  const params = new URLSearchParams({
    engine: 'google_scholar',
    q: query,
    api_key: apiKey,
    num: String(limit),
    hl: 'zh-cn',  // 中文界面，优先返回中文结果
  });

  const resp = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SerpAPI HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json() as any;

  return (json.organic_results ?? []).slice(0, limit).map((r: any) => {
    const pubInfo = r.publication_info?.summary ?? '';
    // 解析 "张粒子, 唐成鹏, 刘方… - 中国电机工程学报, 2021" 格式
    const parts = pubInfo.split(' - ');
    const authorStr = parts[0] ?? '';
    const venueStr = parts[1] ?? '';

    const authors = authorStr
      .split(/[,，]/)
      .map((a: string) => a.replace(/…$/, '').trim())
      .filter(Boolean);

    const journalMatch = venueStr.match(/^([^,，\d]+)/);
    const journal = journalMatch ? journalMatch[1].trim() : null;

    const yearMatch = venueStr.match(/((?:19|20)\d{2})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    return {
      title: r.title ?? '',
      authors,
      journal,
      year,
      citedBy: r.inline_links?.cited_by?.total ?? null,
      snippet: r.snippet ?? null,
      link: r.link ?? null,
      source: 'google_scholar',
    };
  });
}

// ═══════════════════════════════════════════════════════
//  Tavily Advanced（对照组）
// ═══════════════════════════════════════════════════════

async function searchTavilyAdvanced(apiKey: string, query: string, limit = 5): Promise<ScholarResult[]> {
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${query} 论文`,  // 加"论文"提升学术相关性
      max_results: limit,
      search_depth: 'advanced',  // 深度搜索，提取更多内容
      include_answer: false,
    }),
  });
  if (!resp.ok) throw new Error(`Tavily HTTP ${resp.status}`);
  const json = await resp.json() as any;

  return (json.results ?? []).map((r: any) => {
    const text = `${r.title ?? ''} ${r.content ?? ''}`;
    const yearMatch = text.match(/((?:19|20)\d{2})/);
    const journalMatch = text.match(/《([^》]+)》/);

    // 尝试从内容中提取作者
    let authors: string[] = [];
    const authorMatch = text.match(/(?:作者|作　者)[：:]\s*([^\n。]+)/);
    if (authorMatch) {
      authors = authorMatch[1].split(/[,，;；\s]+/).map(a => a.trim()).filter(a => a.length >= 2).slice(0, 6);
    }

    return {
      title: r.title ?? '',
      authors,
      journal: journalMatch?.[1] ?? null,
      year: yearMatch ? parseInt(yearMatch[1]) : null,
      citedBy: null,
      snippet: (r.content ?? '').slice(0, 200) || null,
      link: r.url ?? null,
      source: `tavily(${r.url ? new URL(r.url).hostname : '?'})`,
    };
  });
}

// ── 打印 ──

function printResult(i: number, r: ScholarResult) {
  console.log(`  [${i + 1}] ${r.title}`);
  if (r.authors.length) console.log(`      作者: ${r.authors.slice(0, 5).join(', ')}`);
  if (r.journal) console.log(`      期刊: ${r.journal}`);
  if (r.year) console.log(`      年份: ${r.year}`);
  if (r.citedBy != null) console.log(`      被引: ${r.citedBy}`);
  if (r.snippet) console.log(`      摘要: ${r.snippet.slice(0, 100)}...`);
  if (r.link) console.log(`      链接: ${r.link}`);
  console.log(`      来源: ${r.source}`);
}

// ── 测试用例：不同程度隐藏元信息 ──

const testCases = [
  {
    label: '论文① (仅标题关键词)',
    query: '多智能体强化学习 电力现货市场定价机制 结合理论与仿真',
  },
  {
    label: '论文② (主题关键词)',
    query: '绿证 碳排放权交易 电力市场 协同减碳效应 仿真',
  },
  {
    label: '论文③ (标题后半段)',
    query: '日前电碳耦合市场运行策略',
  },
  {
    label: '论文④ (3个核心概念)',
    query: '动态碳排放强度 电碳市场耦合 建模方法',
  },
];

// ── main ──

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   中文文献搜索 — SerpAPI Google Scholar vs Tavily Advanced ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const serpApiKey = process.env.SERPAPI_KEY ?? '';
  const tomlPath = path.resolve(__dirname, '..', 'config', 'abyssal.toml');
  const toml = require('smol-toml');
  const config = toml.parse(fs.readFileSync(tomlPath, 'utf-8')) as any;
  const tavilyKey = config?.api_keys?.web_search_api_key as string ?? '';

  console.log(`\n  SerpAPI key: ${serpApiKey ? `✓ (${serpApiKey.slice(0, 8)}...)` : '✗ 未设置 (SERPAPI_KEY=xxx)'}`);
  console.log(`  Tavily key:  ${tavilyKey ? `✓ (${tavilyKey.slice(0, 12)}...)` : '✗ 未配置'}`);

  if (!serpApiKey && !tavilyKey) {
    console.log('\n  ❌ 至少需要一个 API key');
    return;
  }

  for (const tc of testCases) {
    console.log(`\n${'═'.repeat(62)}`);
    console.log(`${tc.label}`);
    console.log(`  查询: "${tc.query}"`);

    // ── SerpAPI Google Scholar ──
    if (serpApiKey) {
      console.log('\n  ── Google Scholar (SerpAPI) ──');
      const t0 = Date.now();
      try {
        const results = await searchGoogleScholar(serpApiKey, tc.query, 3);
        console.log(`  ${results.length} 条 (${Date.now() - t0}ms)\n`);
        for (let i = 0; i < results.length; i++) printResult(i, results[i]);
      } catch (err) {
        console.log(`  ❌ ${(err as Error).message}`);
      }
    }

    // ── Tavily Advanced ──
    if (tavilyKey) {
      console.log('\n  ── Tavily Advanced (无域名限制) ──');
      const t1 = Date.now();
      try {
        const results = await searchTavilyAdvanced(tavilyKey, tc.query, 3);
        console.log(`  ${results.length} 条 (${Date.now() - t1}ms)\n`);
        for (let i = 0; i < results.length; i++) printResult(i, results[i]);
      } catch (err) {
        console.log(`  ❌ ${(err as Error).message}`);
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${'═'.repeat(62)}`);
  console.log('完成\n');
}

main().catch((err) => {
  console.error('致命错误:', err);
  process.exit(1);
});
