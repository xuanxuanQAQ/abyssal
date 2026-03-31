/**
 * 代理 vs 直连对比测试
 * npx tsx scripts/proxy-compare.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const OUT = path.join(os.tmpdir(), 'abyssal-diagnose');
fs.mkdirSync(OUT, { recursive: true });

const URL = 'https://journals.plos.org/plosone/article/file?id=10.1371%2Fjournal.pone.0185809&type=printable';

async function main() {
  const { ConsoleLogger } = await import('../src/core/infra/logger');
  const { HttpClient } = await import('../src/core/infra/http-client');
  const { downloadPdf } = await import('../src/core/acquire/downloader');
  const { validatePdf } = await import('../src/core/acquire/pdf-validator');

  const logger = new ConsoleLogger('warn');

  // ── 直连 ──
  console.log('=== 直连下载 PLOS PDF (15s timeout) ===');
  const directClient = new HttpClient({ logger });
  const directPath = path.join(OUT, 'plos-direct.pdf');
  try { fs.unlinkSync(directPath); } catch {}

  const t1 = Date.now();
  try {
    await downloadPdf(directClient, URL, directPath, 15_000);
    const v = await validatePdf(directPath);
    console.log(`  直连: ${Date.now() - t1}ms, valid=${v.valid}, size=${fs.statSync(directPath).size}`);
  } catch (err) {
    console.log(`  直连: FAILED after ${Date.now() - t1}ms — ${(err as Error).message}`);
  }

  // ── 代理 ──
  console.log('\n=== 代理下载 PLOS PDF (http://127.0.0.1:7890) ===');
  const proxyClient = new HttpClient({ logger, proxyUrl: 'http://127.0.0.1:7890' });
  const proxyPath = path.join(OUT, 'plos-proxy.pdf');
  try { fs.unlinkSync(proxyPath); } catch {}

  const t2 = Date.now();
  try {
    await downloadPdf(proxyClient, URL, proxyPath, 30_000);
    const v = await validatePdf(proxyPath);
    console.log(`  代理: ${Date.now() - t2}ms, valid=${v.valid}, size=${fs.statSync(proxyPath).size}`);
  } catch (err) {
    console.log(`  代理: FAILED after ${Date.now() - t2}ms — ${(err as Error).message}`);
  }

  // ── Sci-Hub 代理测试 ──
  console.log('\n=== 代理访问 Sci-Hub ===');
  for (const domain of ['sci-hub.se', 'sci-hub.st', 'sci-hub.ru']) {
    const t = Date.now();
    try {
      const resp = await proxyClient.request(`https://${domain}/`, {
        timeoutMs: 10_000,
        headers: { Accept: 'text/html' },
      });
      console.log(`  ${domain}: HTTP ${resp.status} (${Date.now() - t}ms)`);
    } catch (err) {
      console.log(`  ${domain}: FAILED (${Date.now() - t}ms) — ${(err as Error).message}`);
    }
  }
}

main().catch(console.error);
