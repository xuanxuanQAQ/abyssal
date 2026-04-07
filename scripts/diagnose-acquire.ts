/**
 * Acquire 管线分层诊断脚本
 *
 * 用法: npx tsx scripts/diagnose-acquire.ts
 *
 * 从最底层开始逐层测试，精准定位故障点：
 *   Level 0: 原生 HTTP — 能不能联网？
 *   Level 1: HttpClient — 我们的封装有没有问题？
 *   Level 2: HttpClient + 代理 — 代理配得对不对？
 *   Level 3: Fast Path — 给 100% 能拿到的 OA 论文 URL，能下载吗？
 *   Level 4: Recon — DOI 侦察能不能正常工作？
 *   Level 5: 完整管线 — arXiv 论文端到端获取
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import * as http from 'node:http';

const OUT_DIR = path.join(os.tmpdir(), 'abyssal-diagnose');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── 颜色输出 ───

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function ok(msg: string) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function fail(msg: string) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function info(msg: string) { console.log(`  ${DIM}${msg}${RESET}`); }
function header(level: number, title: string) {
  console.log(`\n${CYAN}${BOLD}═══ Level ${level}: ${title} ═══${RESET}`);
}

// ─── 100% 可下载的测试 URL ───

const TEST_URLS = {
  // httpbin: 基础连通性测试（总是返回 JSON）
  httpbin: 'https://httpbin.org/get',
  // arXiv PDF: "Attention Is All You Need" — 永久 OA
  arxivPdf: 'https://arxiv.org/pdf/1706.03762.pdf',
  // 一个小的已知可用 PDF（W3C 规范，永久可用）
  smallPdf: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
  // OpenAlex API: 免费，无需认证
  openAlex: 'https://api.openalex.org/works/doi:10.48550/arXiv.1706.03762',
};

// ─── Level 0: 原生 Node.js HTTP ───

async function level0_rawHttp(): Promise<boolean> {
  header(0, '原生 HTTP 连通性');
  info('测试 Node.js 能否直接发 HTTPS 请求（不经过任何封装）');

  // 0a: httpbin
  try {
    const body = await rawGet(TEST_URLS.httpbin, 10_000);
    const json = JSON.parse(body);
    if (json.url) {
      ok(`httpbin.org 可达 (${body.length} bytes)`);
    } else {
      fail('httpbin.org 返回了非预期内容');
      return false;
    }
  } catch (err) {
    fail(`httpbin.org 不可达: ${(err as Error).message}`);
    info('→ 基础网络有问题，检查 DNS / 防火墙 / 系统代理');
    return false;
  }

  // 0b: arXiv (确认学术网站可达)
  try {
    const body = await rawGet('https://arxiv.org/abs/1706.03762', 10_000);
    if (body.includes('Attention Is All You Need') || body.includes('arxiv')) {
      ok('arxiv.org 可达');
    } else {
      warn('arxiv.org 返回了内容但可能被重定向/拦截');
    }
  } catch (err) {
    fail(`arxiv.org 不可达: ${(err as Error).message}`);
    info('→ arXiv 可能被墙或 DNS 污染，需要代理');
  }

  return true;
}

function rawGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https') ? https : http;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const req = transport.get(url, { signal: controller.signal as any }, (res) => {
      // Follow redirects manually
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        rawGet(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function rawGetBinary(url: string, timeoutMs: number): Promise<{ data: Buffer; contentType: string | undefined }> {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https') ? https : http;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const req = transport.get(url, { signal: controller.signal as any }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        rawGetBinary(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ data: Buffer.concat(chunks), contentType: res.headers['content-type'] });
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Level 1: HttpClient 封装 ───

async function level1_httpClient(): Promise<boolean> {
  header(1, 'HttpClient 封装');
  info('测试我们的 HttpClient 类能否正常工作');

  const { ConsoleLogger } = await import('../src/core/infra/logger');
  const { HttpClient } = await import('../src/core/infra/http-client');

  const logger = new ConsoleLogger('warn'); // 只显示警告
  const client = new HttpClient({ logger });

  // 1a: request()
  try {
    const resp = await client.request(TEST_URLS.httpbin, { timeoutMs: 10_000 });
    if (resp.status === 200) {
      ok(`HttpClient.request() 正常 (HTTP ${resp.status}, ${resp.body.length} bytes)`);
    } else {
      fail(`HttpClient.request() 返回 HTTP ${resp.status}`);
      return false;
    }
  } catch (err) {
    fail(`HttpClient.request() 失败: ${(err as Error).message}`);
    return false;
  }

  // 1b: requestJson()
  try {
    const data = await client.requestJson<{ url: string }>(TEST_URLS.httpbin, { timeoutMs: 10_000 });
    if (data.url) {
      ok(`HttpClient.requestJson() 正常`);
    }
  } catch (err) {
    fail(`HttpClient.requestJson() 失败: ${(err as Error).message}`);
    return false;
  }

  // 1c: streamDownload() — 下载一个小 PDF
  const testPdfPath = path.join(OUT_DIR, 'test-small.pdf');
  try {
    const result = await client.streamDownload(TEST_URLS.smallPdf, testPdfPath, { timeoutMs: 15_000 });
    const exists = fs.existsSync(testPdfPath);
    const size = exists ? fs.statSync(testPdfPath).size : 0;
    if (exists && size > 100) {
      ok(`HttpClient.streamDownload() 正常 (${size} bytes, ${result.durationMs}ms)`);
      // Check PDF header
      const head = fs.readFileSync(testPdfPath).subarray(0, 5).toString();
      if (head === '%PDF-') {
        ok('下载内容是有效 PDF');
      } else {
        fail(`下载内容不是 PDF (头部: "${head}")`);
        info('→ 可能是被防火墙/代理拦截返回了 HTML 页面');
        return false;
      }
    } else {
      fail('streamDownload 完成但文件为空或不存在');
      return false;
    }
  } catch (err) {
    fail(`HttpClient.streamDownload() 失败: ${(err as Error).message}`);
    return false;
  } finally {
    try { fs.unlinkSync(testPdfPath); } catch {}
  }

  return true;
}

// ─── Level 2: 代理测试 ───

async function level2_proxy(): Promise<boolean> {
  header(2, '代理配置');

  // 读取用户配置
  let proxyEnabled = false;
  let proxyUrl = 'http://127.0.0.1:7890';
  try {
    const { ConfigLoader } = await import('../src/core/infra/config');
    const { loadGlobalConfig } = await import('../src/core/infra/global-config');
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const globalCfg = loadGlobalConfig(path.join(appData, 'abyssal'));
    proxyEnabled = (globalCfg as any)?.acquire?.proxyEnabled ?? false;
    proxyUrl = (globalCfg as any)?.acquire?.proxyUrl ?? 'http://127.0.0.1:7890';
  } catch {
    info('无法读取全局配置，使用默认值');
  }

  if (!proxyEnabled) {
    warn(`代理未启用 (proxyEnabled=false)`);
    info(`配置的代理地址: ${proxyUrl}`);
    info('→ 如果学术网站被墙，需要在设置中开启代理');

    // 尝试测试代理是否可用（即使未启用）
    info(`尝试连接 ${proxyUrl} ...`);
    const proxyReachable = await testProxyConnectivity(proxyUrl);
    if (proxyReachable) {
      ok(`代理 ${proxyUrl} 可连接（但未启用）`);
    } else {
      warn(`代理 ${proxyUrl} 不可连接`);
    }
    return true; // 代理没启用不算失败
  }

  info(`代理已启用: ${proxyUrl}`);

  const { ConsoleLogger } = await import('../src/core/infra/logger');
  const { HttpClient } = await import('../src/core/infra/http-client');

  const logger = new ConsoleLogger('warn');
  const proxyClient = new HttpClient({ logger, proxyUrl });

  // 2a: 通过代理访问 httpbin
  try {
    const resp = await proxyClient.request(TEST_URLS.httpbin, { timeoutMs: 15_000 });
    ok(`代理 → httpbin.org: HTTP ${resp.status}`);
  } catch (err) {
    fail(`代理 → httpbin.org 失败: ${(err as Error).message}`);
    info('→ 检查代理软件是否运行、端口是否正确');
    return false;
  }

  // 2b: 通过代理访问 Sci-Hub（最典型的被墙网站）
  const scihubDomains = ['sci-hub.se', 'sci-hub.st', 'sci-hub.ru'];
  let scihubOk = false;
  for (const domain of scihubDomains) {
    try {
      const resp = await proxyClient.request(`https://${domain}/`, {
        timeoutMs: 10_000,
        headers: { Accept: 'text/html' },
      });
      if (resp.status === 200 || resp.status === 302) {
        ok(`代理 → ${domain}: 可达 (HTTP ${resp.status})`);
        scihubOk = true;
        break;
      }
    } catch {
      info(`  ${domain}: 不可达`);
    }
  }
  if (!scihubOk) {
    warn('Sci-Hub 所有域名都不可达（即使通过代理）');
  }

  return true;
}

async function testProxyConnectivity(proxyUrl: string): Promise<boolean> {
  try {
    const url = new URL(proxyUrl);
    return await new Promise<boolean>((resolve) => {
      const net = require('node:net');
      const socket = net.createConnection(
        { host: url.hostname, port: parseInt(url.port || '7890'), timeout: 3000 },
        () => { socket.destroy(); resolve(true); },
      );
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

// ─── Level 3: Fast Path 下载 ───

async function level3_fastPath(): Promise<boolean> {
  header(3, 'Fast Path 下载 (100% 可靠 OA 论文)');
  info('用确定性 OA URL 测试下载 → 校验全流程');

  const { ConsoleLogger } = await import('../src/core/infra/logger');
  const { HttpClient } = await import('../src/core/infra/http-client');
  const { downloadPdf } = await import('../src/core/acquire/downloader');
  const { validatePdf } = await import('../src/core/acquire/pdf-validator');
  const { tryFastPath } = await import('../src/core/acquire/fast-path');

  const logger = new ConsoleLogger('warn');
  const client = new HttpClient({ logger });

  // 3a: arXiv — 最可靠的源
  const arxivFp = tryFastPath(null, '1706.03762');
  info(`arXiv Fast Path: matched=${arxivFp.matched}, url=${arxivFp.pdfUrl}`);

  const arxivPath = path.join(OUT_DIR, 'diag-arxiv.pdf');
  try {
    await downloadPdf(client, arxivFp.pdfUrl!, arxivPath, 30_000);
    const v = await validatePdf(arxivPath);
    if (v.valid) {
      ok(`arXiv PDF 下载成功 (${fs.statSync(arxivPath).size} bytes, ${v.pageCount} 页)`);
    } else {
      fail(`arXiv PDF 下载了但校验失败: ${v.reason}`);
      // 检查头部
      const head = fs.readFileSync(arxivPath).subarray(0, 100).toString();
      info(`文件头部: ${head.slice(0, 60)}`);
      if (head.includes('<html') || head.includes('<!DOCTYPE')) {
        info('→ 下载到的是 HTML 页面而非 PDF，可能被防火墙拦截');
      }
      return false;
    }
  } catch (err) {
    fail(`arXiv PDF 下载失败: ${(err as Error).message}`);
    return false;
  }

  // 3b: W3C 小 PDF — 排除 arXiv 特殊性
  const w3cPath = path.join(OUT_DIR, 'diag-w3c.pdf');
  try {
    await downloadPdf(client, TEST_URLS.smallPdf, w3cPath, 15_000);
    const v = await validatePdf(w3cPath);
    if (v.valid) {
      ok(`W3C dummy PDF 下载成功 (${fs.statSync(w3cPath).size} bytes)`);
    } else {
      fail(`W3C PDF 校验失败: ${v.reason}`);
      return false;
    }
  } catch (err) {
    fail(`W3C PDF 下载失败: ${(err as Error).message}`);
  }

  return true;
}

// ─── Level 4: Recon ───

async function level4_recon(): Promise<boolean> {
  header(4, 'Recon 侦察层');
  info('测试 DOI HEAD + OpenAlex + CrossRef 并行侦察');

  const { ConsoleLogger } = await import('../src/core/infra/logger');
  const { HttpClient } = await import('../src/core/infra/http-client');
  const { RateLimiter } = await import('../src/core/infra/rate-limiter');
  const { runRecon } = await import('../src/core/acquire/recon');

  const logger = new ConsoleLogger('warn');
  const client = new HttpClient({ logger, userAgentEmail: 'test@example.com' });

  // 用一篇 OA 论文的 DOI
  const doi = '10.1371/journal.pone.0185809';

  try {
    const recon = await runRecon({
      doi,
      http: client,
      openAlexLimiter: new RateLimiter(10, 10 / 1000),
      crossRefLimiter: new RateLimiter(10, 10 / 1000),
      openAlexEmail: 'test@example.com',
      cache: null,
      reconCacheTtlDays: 30,
      oaCacheRefreshDays: 7,
      perSourceTimeoutMs: 15_000,
      logger,
    });

    info('侦察结果:');
    for (const a of recon.reconAttempts) {
      const icon = a.status === 'success' ? GREEN + '✓' : RED + '✗';
      console.log(`    ${icon}${RESET} ${a.source}: ${a.status} (${a.durationMs}ms)${a.failureReason ? ` — ${a.failureReason}` : ''}`);
    }

    if (recon.publisherDomain) {
      ok(`DOI HEAD → 出版商域名: ${recon.publisherDomain}`);
    } else {
      warn('DOI HEAD 未获取到出版商域名');
    }

    if (recon.openAlexData) {
      ok(`OpenAlex: isOa=${recon.openAlexData.isOa}, status=${recon.openAlexData.oaStatus}, pdfs=${recon.openAlexData.pdfUrls.length}`);
      if (recon.openAlexData.pdfUrls.length > 0) {
        info(`  PDF URLs: ${recon.openAlexData.pdfUrls.join(', ')}`);
      }
    } else {
      warn('OpenAlex 未返回数据');
    }

    if (recon.crossRefData) {
      ok(`CrossRef: pdfLinks=${recon.crossRefData.pdfLinks.length}`);
    } else {
      warn('CrossRef 未返回数据');
    }

    return true;
  } catch (err) {
    fail(`Recon 失败: ${(err as Error).message}`);
    return false;
  }
}

// ─── Level 5: 完整管线 ───

async function level5_fullPipeline(): Promise<boolean> {
  header(5, '完整管线端到端');
  info('使用 AcquireService 完整跑一遍 4 层管线');

  const { ConsoleLogger } = await import('../src/core/infra/logger');
  const { AcquireService } = await import('../src/core/acquire/index');
  const { ConfigLoader } = await import('../src/core/infra/config');

  const logger = new ConsoleLogger('info');

  // 尽量加载真实配置，fallback 到 defaults
  let config: any;
  try {
    const loader = new ConfigLoader(logger);
    config = loader.loadSync(process.cwd());
  } catch {
    info('无法加载项目配置，使用最小化配置');
    config = buildMinimalConfig();
  }

  const service = new AcquireService(config, logger);

  // 5a: arXiv 论文（应该走 Fast Path 秒过）
  const arxivPath = path.join(OUT_DIR, 'pipeline-arxiv.pdf');
  try { fs.unlinkSync(arxivPath); } catch {}

  info('测试 A: arXiv 论文 (arxivId=1706.03762) — 应走 Fast Path');
  const t1 = Date.now();
  const r1 = await service.acquireFulltext({
    doi: '10.48550/arXiv.1706.03762',
    arxivId: '1706.03762',
    pmcid: null,
    url: null,
    savePath: arxivPath,
  });
  const d1 = Date.now() - t1;
  printPipelineResult(r1, d1);

  if (r1.status !== 'success') {
    fail('arXiv 论文获取失败 — 管线有 BUG');
    return false;
  }
  ok(`arXiv 论文获取成功 (${d1}ms, source=${r1.source})`);

  // 5b: PLOS 论文（100% OA，应走 Fast Path）
  const plosPath = path.join(OUT_DIR, 'pipeline-plos.pdf');
  try { fs.unlinkSync(plosPath); } catch {}

  info('测试 B: PLOS ONE 论文 (doi=10.1371/journal.pone.0185809) — 应走 Fast Path');
  const t2 = Date.now();
  const r2 = await service.acquireFulltext({
    doi: '10.1371/journal.pone.0185809',
    arxivId: null,
    pmcid: null,
    url: null,
    savePath: plosPath,
  });
  const d2 = Date.now() - t2;
  printPipelineResult(r2, d2);

  if (r2.status !== 'success') {
    warn('PLOS 论文获取失败');
    info('→ 如果 Level 3 的 arXiv 测试通过了但这里失败，说明 PLOS 网站可能被墙或管线逻辑有问题');
  } else {
    ok(`PLOS 论文获取成功 (${d2}ms, source=${r2.source})`);
  }

  // 5c: 幂等性 — 再次获取 arXiv（应直接返回 cached）
  info('测试 C: 幂等性 — 重复获取 arXiv 论文');
  const t3 = Date.now();
  const r3 = await service.acquireFulltext({
    doi: '10.48550/arXiv.1706.03762',
    arxivId: '1706.03762',
    pmcid: null,
    url: null,
    savePath: arxivPath,
  });
  const d3 = Date.now() - t3;
  if (r3.source === 'cached' && d3 < 500) {
    ok(`幂等性正常: ${d3}ms (source=cached)`);
  } else {
    warn(`幂等性异常: ${d3}ms, source=${r3.source}`);
  }

  return r1.status === 'success';
}

function printPipelineResult(r: any, duration: number) {
  info(`  状态: ${r.status} | 来源: ${r.source ?? '—'} | 耗时: ${duration}ms`);
  if (r.pdfPath) info(`  路径: ${r.pdfPath}`);
  if (r.fileSize) info(`  大小: ${(r.fileSize / 1024).toFixed(1)} KB`);
  if (r.attempts?.length > 0) {
    info('  尝试记录:');
    for (const a of r.attempts) {
      const icon = a.status === 'success' ? '✓' : '✗';
      console.log(`    ${DIM}${icon} ${a.source}: ${a.status} (${a.durationMs}ms)${a.failureReason ? ' — ' + a.failureReason : ''}${RESET}`);
    }
  }
}

function buildMinimalConfig() {
  return {
    project: { name: 'diagnose', description: '' },
    acquire: {
      enabledSources: ['unpaywall', 'arxiv', 'pmc'],
      enableScihub: false,
      scihubDomain: null,
      institutionalProxyUrl: null,
      perSourceTimeoutMs: 30_000,
      maxRedirects: 5,
      maxRetries: 2,
      retryDelayMs: 1000,
      scihubMaxTotalMs: 60_000,
      tarMaxExtractBytes: 200_000_000,
      enableChinaInstitutional: false,
      chinaInstitutionId: null,
      chinaCustomIdpEntityId: null,
      enableFastPath: true,
      enableRecon: true,
      reconCacheTtlDays: 30,
      oaCacheRefreshDays: 7,
      reconTimeoutMs: 10_000,
      enablePreflight: true,
      preflightTimeoutMs: 5000,
      enableSpeculativeExecution: true,
      maxSpeculativeParallel: 3,
      speculativeTotalTimeoutMs: 45_000,
      ezproxyUrlTemplate: null,
      enableContentSanityCheck: false,
      proxyEnabled: false,
      proxyUrl: 'http://127.0.0.1:7890',
      proxyMode: 'blocked-only' as const,
    },
    discovery: {
      traversalDepth: 2,
      maxResultsPerQuery: 50,
      concurrency: 3,
    },
    analysis: {
      maxTokensPerChunk: 80000,
      overlapTokens: 200,
      ocrEnabled: false,
      vlmEnabled: false,
      autoSuggestConcepts: true,
      minConceptFrequency: 2,
      maxConcepts: 200,
    },
    rag: {
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
      embeddingProvider: 'openai',
      defaultTopK: 10,
      expandFactor: 3,
      rerankerBackend: 'jina',
      rerankerModel: '',
      correctiveRagEnabled: false,
      correctiveRagMaxRetries: 1,
      correctiveRagModel: '',
      tentativeExpandFactorMultiplier: 1.5,
      tentativeTopkMultiplier: 1.5,
      crossConceptBoostFactor: 1.2,
    },
    language: {
      internalWorkingLanguage: 'en',
      defaultOutputLanguage: 'zh',
      uiLocale: 'zh-CN',
    },
    llm: {
      defaultProvider: 'claude',
      defaultModel: 'claude-sonnet-4-20250514',
      workflowOverrides: {},
    },
    apiKeys: {
      anthropicApiKey: null,
      openaiApiKey: null,
      deepseekApiKey: null,
      semanticScholarApiKey: null,
      openalexEmail: 'test@example.com',
      unpaywallEmail: 'test@example.com',
      cohereApiKey: null,
      jinaApiKey: null,
      siliconflowApiKey: null,
      doubaoApiKey: null,
      kimiApiKey: null,
      webSearchApiKey: null,
    },
    workspace: { baseDir: OUT_DIR },
    contextBudget: {
      focusedMaxTokens: 30000,
      broadMaxTokens: 80000,
      outputReserveRatio: 0.2,
      safetyMarginRatio: 0.05,
      skipRerankerThreshold: 0.8,
      costPreference: 'balanced',
    },
    personalization: { authorDisplayThreshold: 1 },
  };
}

// ─── 主流程 ───

async function main() {
  console.log(`${BOLD}Abyssal Acquire 管线分层诊断${RESET}`);
  console.log(`输出目录: ${OUT_DIR}`);
  console.log(`时间: ${new Date().toLocaleString()}`);

  const results: Array<[string, boolean]> = [];

  // 逐层执行，某层失败时后面可以继续但会标记
  results.push(['Level 0: 原生 HTTP', await level0_rawHttp()]);
  results.push(['Level 1: HttpClient', await level1_httpClient()]);
  results.push(['Level 2: 代理配置', await level2_proxy()]);
  results.push(['Level 3: Fast Path', await level3_fastPath()]);
  results.push(['Level 4: Recon', await level4_recon()]);
  results.push(['Level 5: 完整管线', await level5_fullPipeline()]);

  // 汇总
  console.log(`\n${BOLD}${CYAN}═══ 诊断结果 ═══${RESET}`);
  let allPass = true;
  for (const [name, pass] of results) {
    console.log(`  ${pass ? GREEN + '✓ PASS' : RED + '✗ FAIL'}${RESET}  ${name}`);
    if (!pass) allPass = false;
  }

  if (allPass) {
    console.log(`\n${GREEN}${BOLD}全部通过！管线工作正常。${RESET}`);
  } else {
    console.log(`\n${YELLOW}${BOLD}诊断建议：${RESET}`);
    // 根据哪层失败给出针对性建议
    const l0 = results[0]![1], l1 = results[1]![1], l3 = results[3]![1];
    if (!l0) {
      console.log(`  → 基础网络不通，检查 DNS / 防火墙 / 系统代理设置`);
    } else if (!l1) {
      console.log(`  → HttpClient 封装有 BUG，需要检查 src/core/infra/http-client.ts`);
    } else if (!l3) {
      console.log(`  → 能发请求但下载 PDF 失败，可能需要开启代理`);
    } else {
      console.log(`  → 底层网络正常，问题在管线逻辑层，查看上方具体失败信息`);
    }
  }

  console.log(`\n下载的测试文件在: ${OUT_DIR}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(`${RED}Fatal:${RESET}`, err);
  process.exit(1);
});
