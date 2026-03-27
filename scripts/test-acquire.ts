/**
 * Acquire 管线冒烟测试
 *
 * 用法: npx tsx scripts/test-acquire.ts
 *
 * 测试内容：
 *   1. arXiv 直链下载（最可靠）
 *   2. Unpaywall OA 查询 + 下载
 *   3. PMC 下载（生物医学论文）
 *   4. 级联逻辑：给错误 DOI，观察逐级 fallback
 *   5. 幂等性：同一论文第二次调用直接返回 cached
 *   6. PDF 校验器独立测试
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AcquireService } from '../src/core/acquire/index';
import { validatePdf } from '../src/core/acquire/pdf-validator';
import { ConsoleLogger } from '../src/core/infra/logger';
import type { AbyssalConfig } from '../src/core/types/config';

// ─── 测试输出目录 ───
const OUT_DIR = path.join(os.tmpdir(), 'abyssal-acquire-test');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── 最小化配置 ───
const testConfig: AbyssalConfig = {
  project: { name: 'test', description: '', mode: 'auto' },
  acquire: {
    enabledSources: ['unpaywall', 'arxiv', 'pmc'],
    enableScihub: false,
    scihubDomain: null,
    institutionalProxyUrl: null,
    perSourceTimeoutMs: 30_000,
    maxRedirects: 5,
  },
  discovery: {
    traversalDepth: 2,
    maxPapersPerSeed: 100,
    citationDirection: 'both',
    includeRelated: true,
    maxRelatedPapers: 20,
  },
  analysis: {
    minConceptFrequency: 2,
    maxConcepts: 200,
    heatmapNormalization: 'row',
    additiveChangeLookbackDays: 30,
    autoSuggestThreshold: 3,
  },
  rag: {
    chunkSize: 512,
    chunkOverlap: 64,
    topK: 10,
    minScore: 0.3,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
  },
  language: { ui: 'zh-CN', queryLanguage: 'en' },
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 4096,
    contextWindow: 128_000,
    baseUrl: null,
  },
  apiKeys: {
    openaiApiKey: null,
    deepseekApiKey: null,
    semanticScholarApiKey: null,
    openalexEmail: 'test@example.com',
    unpaywallEmail: 'test@example.com',  // Unpaywall 只需要一个邮箱
    cohereApiKey: null,
    jinaApiKey: null,
  },
  workspace: {
    rootDir: OUT_DIR,
    pdfDir: path.join(OUT_DIR, 'pdfs'),
    dbPath: path.join(OUT_DIR, 'test.db'),
  },
  concepts: {
    maxConcepts: 200,
    minFrequency: 2,
    autoSuggestThreshold: 3,
  },
} as AbyssalConfig;

const logger = new ConsoleLogger('debug');
const service = new AcquireService(testConfig, logger);

// ─── 辅助 ───
function header(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function printResult(result: { status: string; source?: string | null; pdfPath?: string | null; sha256?: string | null; fileSize?: number | null; attempts: Array<{ source: string; status: string; durationMs: number; failureReason?: string | null }> }) {
  console.log(`  状态: ${result.status}`);
  console.log(`  来源: ${result.source ?? '—'}`);
  console.log(`  路径: ${result.pdfPath ?? '—'}`);
  console.log(`  SHA256: ${result.sha256?.slice(0, 16) ?? '—'}...`);
  console.log(`  大小: ${result.fileSize ? `${(result.fileSize / 1024).toFixed(1)} KB` : '—'}`);
  console.log('  尝试记录:');
  for (const a of result.attempts) {
    const icon = a.status === 'success' ? '✓' : a.status === 'skipped' ? '○' : '✗';
    console.log(`    ${icon} ${a.source}: ${a.status} (${a.durationMs}ms)${a.failureReason ? ' — ' + a.failureReason : ''}`);
  }
}

// ─── 测试用例 ───

// "Attention Is All You Need" — 有 arXiv ID，也有 DOI
const ATTENTION_ARXIV = '1706.03762';
const ATTENTION_DOI = '10.48550/arXiv.1706.03762';

// 一篇 OA 生物医学论文 — 有 DOI + PMCID
const BIO_DOI = '10.1371/journal.pone.0185809';
const BIO_PMCID = 'PMC5636100';

async function testArxivDirect() {
  header('Test 1: arXiv 直链下载');
  const savePath = path.join(OUT_DIR, 'attention-arxiv.pdf');
  if (fs.existsSync(savePath)) fs.unlinkSync(savePath);

  const result = await service.acquireFulltext({
    doi: null,
    arxivId: ATTENTION_ARXIV,
    pmcid: null,
    url: null,
    savePath,
    enabledSources: ['arxiv'],  // 仅测试 arXiv
  });

  printResult(result);
  return result.status === 'success';
}

async function testUnpaywall() {
  header('Test 2: Unpaywall OA 查询');
  const savePath = path.join(OUT_DIR, 'bio-unpaywall.pdf');
  if (fs.existsSync(savePath)) fs.unlinkSync(savePath);

  const result = await service.acquireFulltext({
    doi: BIO_DOI,
    arxivId: null,
    pmcid: null,
    url: null,
    savePath,
    enabledSources: ['unpaywall'],
  });

  printResult(result);
  return result.status === 'success';
}

async function testPmc() {
  header('Test 3: PubMed Central 下载');
  const savePath = path.join(OUT_DIR, 'bio-pmc.pdf');
  if (fs.existsSync(savePath)) fs.unlinkSync(savePath);

  const result = await service.acquireFulltext({
    doi: null,
    arxivId: null,
    pmcid: BIO_PMCID,
    url: null,
    savePath,
    enabledSources: ['pmc'],
  });

  printResult(result);
  return result.status === 'success';
}

async function testCascadeFallback() {
  header('Test 4: 级联 fallback（Unpaywall 失败 → arXiv 成功）');
  const savePath = path.join(OUT_DIR, 'attention-cascade.pdf');
  if (fs.existsSync(savePath)) fs.unlinkSync(savePath);

  // 用 arXiv 论文的 DOI 查 Unpaywall（可能查不到 OA PDF），然后 fallback 到 arXiv
  const result = await service.acquireFulltext({
    doi: ATTENTION_DOI,
    arxivId: ATTENTION_ARXIV,
    pmcid: null,
    url: null,
    savePath,
    enabledSources: ['unpaywall', 'arxiv'],
  });

  printResult(result);
  console.log(`  级联行为: ${result.attempts.length} 次尝试`);
  return result.status === 'success';
}

async function testIdempotency() {
  header('Test 5: 幂等性（已有 PDF 直接返回 cached）');
  // 复用 Test 1 的文件
  const savePath = path.join(OUT_DIR, 'attention-arxiv.pdf');

  if (!fs.existsSync(savePath)) {
    console.log('  ⚠ 跳过：Test 1 未成功下载文件');
    return false;
  }

  const start = Date.now();
  const result = await service.acquireFulltext({
    doi: null,
    arxivId: ATTENTION_ARXIV,
    pmcid: null,
    url: null,
    savePath,
  });

  const elapsed = Date.now() - start;
  printResult(result);
  console.log(`  幂等耗时: ${elapsed}ms（应该 < 100ms，无网络请求）`);
  return result.source === 'cached';
}

async function testPdfValidator() {
  header('Test 6: PDF 校验器');

  // 6a: 校验已下载的有效 PDF
  const validPath = path.join(OUT_DIR, 'attention-arxiv.pdf');
  if (fs.existsSync(validPath)) {
    const v = await validatePdf(validPath);
    console.log(`  有效 PDF: valid=${v.valid}, pages=${v.pageCount}, size=${v.fileSizeBytes}`);
  } else {
    console.log('  ⚠ 跳过有效 PDF 测试（文件不存在）');
  }

  // 6b: 校验一个假文件
  const fakePath = path.join(OUT_DIR, 'fake.pdf');
  fs.writeFileSync(fakePath, 'This is not a PDF file');
  const v2 = await validatePdf(fakePath);
  console.log(`  假 PDF: valid=${v2.valid}, reason="${v2.reason}"`);
  fs.unlinkSync(fakePath);

  return true;
}

async function testAllSourcesExhausted() {
  header('Test 7: 全部源耗尽（返回 failed）');
  const savePath = path.join(OUT_DIR, 'nonexistent.pdf');

  const result = await service.acquireFulltext({
    doi: '10.9999/nonexistent-doi-12345',
    arxivId: null,
    pmcid: null,
    url: null,
    savePath,
    enabledSources: ['unpaywall', 'pmc'],  // 两个都会失败
  });

  printResult(result);
  return result.status === 'failed';
}

// ─── 主流程 ───

async function main() {
  console.log('Acquire 管线冒烟测试');
  console.log(`输出目录: ${OUT_DIR}`);

  const results: Array<[string, boolean]> = [];

  results.push(['arXiv 直链', await testArxivDirect()]);
  results.push(['Unpaywall', await testUnpaywall()]);
  results.push(['PMC', await testPmc()]);
  results.push(['级联 fallback', await testCascadeFallback()]);
  results.push(['幂等性', await testIdempotency()]);
  results.push(['PDF 校验器', await testPdfValidator()]);
  results.push(['全部源耗尽', await testAllSourcesExhausted()]);

  header('测试结果汇总');
  let allPass = true;
  for (const [name, pass] of results) {
    console.log(`  ${pass ? '✓ PASS' : '✗ FAIL'}  ${name}`);
    if (!pass) allPass = false;
  }

  // 清理
  console.log(`\n临时文件在: ${OUT_DIR}`);
  console.log('（可手动删除，或保留用于检查下载的 PDF）');

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
