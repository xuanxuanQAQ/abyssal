// ═══ Level 5: Sci-Hub ═══
// §6.7: 多域名自动探测 + 从 HTML 页面提取 PDF URL + 总超时上限

import type { AcquireAttempt } from '../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt } from '../attempt-utils';

// ─── 已知 Sci-Hub 域名候选列表（按可用性排序） ───

const SCIHUB_DOMAINS = [
  'sci-hub.se',
  'sci-hub.st',
  'sci-hub.ru',
  'sci-hub.mksa.top',
  'sci-hub.ren',
  'sci-hub.ee',
];

// 从 Sci-Hub HTML 提取 PDF URL
const PDF_PATTERNS: RegExp[] = [
  /embed[^>]+type\s*=\s*"application\/pdf"[^>]+src\s*=\s*"([^"]+)"/i,
  /(?:iframe|embed)[^>]+id\s*=\s*"pdf"[^>]+src\s*=\s*"([^"]+)"/i,
  /(?:iframe|embed)[^>]+src\s*=\s*"([^"]*\.pdf[^"]*)"/i,
  /(?:iframe|embed)[^>]+src\s*=\s*"([^"]+)"/i,
];

function extractPdfUrl(html: string, domain: string): string | null {
  for (const pattern of PDF_PATTERNS) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      let url = match[1];
      if (url.startsWith('//')) url = 'https:' + url;
      else if (url.startsWith('/')) url = `https://${domain}${url}`;
      // Reject data URIs, javascript:, empty, and non-http(s) URLs
      if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
      return url;
    }
  }
  return null;
}

/**
 * 尝试单个 Sci-Hub 域名。
 * 返回最后一次 HTTP 请求的状态码以确保 httpStatus 归因准确。
 */
async function tryOneDomain(
  http: HttpClient,
  doi: string,
  domain: string,
  tempPath: string,
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string; httpStatus?: number | null }> {
  try {
    const pageUrl = `https://${domain}/${doi}`;
    const response = await http.request(pageUrl, { timeoutMs });

    const pdfUrl = extractPdfUrl(response.body, domain);
    if (!pdfUrl) {
      return { ok: false, error: `${domain}: PDF URL extraction failed`, httpStatus: response.status };
    }

    await downloadPdf(http, pdfUrl, tempPath, timeoutMs);
    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return { ok: false, error: `${domain}: ${validation.reason ?? 'PDF validation failed'}`, httpStatus: null };
    }

    return { ok: true, httpStatus: 200 };
  } catch (err) {
    deleteFileIfExists(tempPath);
    return { ok: false, error: `${domain}: ${(err as Error).message}`, httpStatus: null };
  }
}

/**
 * 多域名级联尝试，带总超时上限。
 * configDomain 作为首选（如果有），其余候选域名依次尝试。
 */
export async function tryScihub(
  http: HttpClient,
  doi: string,
  configDomain: string,
  tempPath: string,
  timeoutMs: number,
  maxTotalMs: number = 60_000,
): Promise<AcquireAttempt> {
  const start = Date.now();

  // 构建去重的域名列表：配置域名优先，然后是候选列表
  const domains = [configDomain, ...SCIHUB_DOMAINS.filter((d) => d !== configDomain)];
  const errors: string[] = [];

  for (const domain of domains) {
    // 总超时检查
    const elapsed = Date.now() - start;
    if (elapsed >= maxTotalMs) {
      return makeAttempt('scihub', 'timeout', elapsed, {
        failureReason: `Total timeout exceeded (${maxTotalMs}ms) after trying ${errors.length} domain(s)`,
        failureCategory: 'timeout',
      });
    }

    // 为剩余时间动态计算单域名超时
    const remainingMs = maxTotalMs - elapsed;
    const perDomainTimeout = Math.min(timeoutMs, remainingMs);

    const result = await tryOneDomain(http, doi, domain, tempPath, perDomainTimeout);
    if (result.ok) {
      return makeAttempt('scihub', 'success', Date.now() - start, { httpStatus: result.httpStatus ?? 200 });
    }
    errors.push(result.error!);
  }

  return makeAttempt('scihub', 'failed', Date.now() - start, {
    failureReason: `All ${domains.length} domains failed: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
    failureCategory: 'unknown',
  });
}
