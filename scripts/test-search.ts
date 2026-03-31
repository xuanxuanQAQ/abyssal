/**
 * Search 模块冒烟测试 —— 直接调用真实 API。
 *
 * 用法：
 *   npx tsx scripts/test-search.ts
 *
 * 可选环境变量（加速 Semantic Scholar）：
 *   S2_API_KEY=xxx npx tsx scripts/test-search.ts
 */

import { SearchService } from '../src/core/search';
import { ConsoleLogger } from '../src/core/infra/logger';
import type { AbyssalConfig } from '../src/core/types/config';
import type { PaperMetadata } from '../src/core/types/paper';

// ── 构造最小配置 ──

const minimalConfig = {
  apiKeys: {
    semanticScholarApiKey: process.env.S2_API_KEY ?? null,
    openalexEmail: process.env.OA_EMAIL ?? null,
    anthropicApiKey: null,
    openaiApiKey: null,
    deepseekApiKey: null,
    unpaywallEmail: null,
    cohereApiKey: null,
    jinaApiKey: null,
    siliconflowApiKey: null,
  },
} as AbyssalConfig;

const logger = new ConsoleLogger('info');
const search = new SearchService(minimalConfig, logger);

// ── 辅助 ──

function printPapers(label: string, papers: PaperMetadata[]) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label} — 共 ${papers.length} 条`);
  console.log('='.repeat(60));
  for (const p of papers.slice(0, 5)) {
    console.log(`  [${p.year}] ${p.title}`);
    if (p.doi) console.log(`         doi: ${p.doi}`);
  }
  if (papers.length > 5) console.log(`  ... 省略 ${papers.length - 5} 条`);
}

async function runTest(name: string, fn: () => Promise<void>) {
  console.log(`\n🔍 ${name}...`);
  const t0 = Date.now();
  try {
    await fn();
    console.log(`   ✅ 耗时 ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`   ❌ 失败 (${Date.now() - t0}ms):`, (err as Error).message);
  }
}

// ── 逐个测试 ──

async function main() {
  // 1. Semantic Scholar（无 key 容易限流，有 key 则测试）
  if (process.env.S2_API_KEY) {
    await runTest('Semantic Scholar 搜索', async () => {
      const papers = await search.searchSemanticScholar(
        'transformer attention mechanism', { limit: 5 },
      );
      printPapers('Semantic Scholar', papers);
    });

    await runTest('Semantic Scholar 论文详情 (Attention is All You Need)', async () => {
      const detail = await search.getPaperDetails('10.48550/arXiv.1706.03762');
      console.log(`   标题: ${detail.title}`);
      console.log(`   作者: ${detail.authors.slice(0, 3).join(', ')}...`);
      console.log(`   引用数: ${detail.citationCount}`);
    });
  } else {
    console.log('\n⏭️  跳过 Semantic Scholar（无 S2_API_KEY，容易 429）');
    console.log('   设置 S2_API_KEY 环境变量后可测试');
  }

  // 2. OpenAlex
  await runTest('OpenAlex 概念搜索', async () => {
    const papers = await search.searchOpenAlex(['deep learning'], { limit: 5 });
    printPapers('OpenAlex', papers);
  });

  await runTest('OpenAlex 带过滤搜索', async () => {
    const papers = await search.searchOpenAlex(
      ['neural network'],
      { limit: 5, yearRange: { min: 2020 }, minCitations: 100 },
    );
    printPapers('OpenAlex (2020+, 100+ citations)', papers);
  });

  // 3. arXiv
  await runTest('arXiv 搜索', async () => {
    const papers = await search.searchArxiv('large language model', { limit: 5 });
    printPapers('arXiv', papers);
  });

  await runTest('arXiv 分类搜索', async () => {
    const papers = await search.searchArxiv('diffusion model', {
      limit: 5,
      categories: ['cs.CV'],
    });
    printPapers('arXiv (cs.CV)', papers);
  });

  // 4. 去重
  await runTest('跨源去重', async () => {
    const oaPapers = await search.searchOpenAlex(['BERT'], { limit: 5 });
    const axPapers = await search.searchArxiv('BERT', { limit: 5 });
    const all = [...oaPapers, ...axPapers];
    const deduped = search.deduplicatePapers(all);
    console.log(`   合并前: ${all.length} 条, 去重后: ${deduped.length} 条`);
    console.log(`   去除重复: ${all.length - deduped.length} 条`);
  });

  // 5. 桥梁论文检测（纯本地计算）
  await runTest('桥梁论文检测（纯计算）', async () => {
    const { asPaperId } = await import('../src/core/types');
    // 12-char hex IDs
    const pA = asPaperId('aaaaaaaaaaaa');
    const pB = asPaperId('bbbbbbbbbbbb');
    const pC = asPaperId('cccccccccccc');
    const pD = asPaperId('dddddddddddd');
    const pE = asPaperId('eeeeeeeeeeee');
    const seeds = [pA, pB];
    const citationMap = new Map([
      [pA, [pC, pD]],
      [pB, [pC, pE]],
      [pC, [pA, pB]],
      [pD, [pA]],
      [pE, [pB]],
    ]);
    const bridges = search.detectBridgePapers(seeds, citationMap);
    console.log('   桥梁论文得分:');
    for (const [id, score] of bridges) {
      console.log(`     ${id}: ${score.toFixed(3)}`);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('冒烟测试完成');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('💥 致命错误:', err);
  process.exit(1);
});
