// ═══ Preflight — MIME Type 预检 + HTML PDF 链接提取 ═══
// 在完整 GET 下载前，用 HEAD 请求检查 Content-Type。
// 防止"假 OA"陷阱：URL 指向 HTML 落地页而非 PDF 二进制流。

import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';

// ─── Types ───

export interface PreflightResult {
  /** URL 是否直接提供 PDF（Content-Type 含 application/pdf） */
  isPdf: boolean;
  /** HEAD 响应的 Content-Type */
  contentType: string | null;
  /** 如果是 HTML，从中提取的 PDF URL 候选列表 */
  extractedPdfUrls: string[];
  /** 预检耗时 */
  durationMs: number;
}

// ─── HTML PDF 链接提取模式 ───

/** 从学术出版商 HTML 页面提取 PDF 下载链接的正则模式（按优先级排列） */
const HTML_PDF_PATTERNS: RegExp[] = [
  // 学术出版商通用标准（Google Scholar 也使用）
  /<meta\s+name=["']citation_pdf_url["']\s+content=["']([^"']+)["']/i,
  // DC metadata
  /<meta\s+name=["']DC\.identifier["']\s+content=["']([^"']+\.pdf[^"']*)["']/i,
  // Embedded PDF viewer
  /embed[^>]+type\s*=\s*["']application\/pdf["'][^>]+src\s*=\s*["']([^"']+)["']/i,
  /(?:iframe|embed)[^>]+id\s*=\s*["']pdf["'][^>]+src\s*=\s*["']([^"']+)["']/i,
  // Generic PDF links (lower priority)
  /(?:iframe|embed)[^>]+src\s*=\s*["']([^"']*\.pdf[^"']*)["']/i,
  // Download button links
  /<a[^>]+href=["']([^"']*\/pdf\/[^"']+)["'][^>]*>/i,
  /<a[^>]+href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*class=["'][^"']*(?:download|pdf)[^"']*["']/i,
];

/**
 * 从 HTML 内容中提取 PDF URL 候选。
 * 返回去重、规范化后的 URL 列表。
 */
export function extractPdfUrlsFromHtml(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const pattern of HTML_PDF_PATTERNS) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      let url = match[1];
      // 相对 URL → 绝对 URL
      if (url.startsWith('//')) {
        url = 'https:' + url;
      } else if (url.startsWith('/')) {
        try {
          url = new URL(url, baseUrl).toString();
        } catch { continue; }
      } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        try {
          url = new URL(url, baseUrl).toString();
        } catch { continue; }
      }
      // 过滤 data URI、javascript: 等
      if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
      if (!seen.has(url)) {
        seen.add(url);
        found.push(url);
      }
    }
  }

  return found;
}

// ─── Preflight 主函数 ───

/**
 * 对目标 URL 执行 HEAD 预检，确认 Content-Type。
 *
 * - `application/pdf` → isPdf=true，可直接 GET 下载
 * - `text/html` → 如果 extractHtmlLinks=true，获取 HTML 并提取 PDF 链接
 * - 其他类型或错误 → isPdf=false
 *
 * 注意：某些 CDN/出版商对 HEAD 请求返回不同于 GET 的 Content-Type。
 * 最终验证仍依赖下载后的 validatePdf()。
 */
export async function preflight(params: {
  url: string;
  http: HttpClient;
  timeoutMs: number;
  extractHtmlLinks?: boolean;
  headers?: Record<string, string>;
  logger: Logger;
}): Promise<PreflightResult> {
  const { url, http, timeoutMs, extractHtmlLinks = true, headers, logger } = params;
  const start = Date.now();

  try {
    // HEAD 请求
    const response = await http.request(url, {
      method: 'HEAD',
      timeoutMs,
      headers: {
        Accept: 'application/pdf, text/html, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...headers,
      },
    });

    const contentType = parseContentType(response.headers);

    if (contentType?.includes('application/pdf')) {
      return { isPdf: true, contentType, extractedPdfUrls: [], durationMs: Date.now() - start };
    }

    // HTML → 提取 PDF 链接
    if (contentType?.includes('text/html') && extractHtmlLinks) {
      try {
        const htmlResponse = await http.request(url, {
          method: 'GET',
          timeoutMs,
          headers: {
            Accept: 'text/html',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            ...headers,
          },
        });
        const extracted = extractPdfUrlsFromHtml(htmlResponse.body, url);
        if (extracted.length > 0) {
          logger.debug('[Preflight] Extracted PDF URLs from HTML', { url, count: extracted.length });
        }
        return { isPdf: false, contentType, extractedPdfUrls: extracted, durationMs: Date.now() - start };
      } catch {
        // HTML 获取失败，返回无提取结果
        return { isPdf: false, contentType, extractedPdfUrls: [], durationMs: Date.now() - start };
      }
    }

    return { isPdf: false, contentType, extractedPdfUrls: [], durationMs: Date.now() - start };
  } catch (err) {
    logger.debug('[Preflight] HEAD request failed', { url, error: (err as Error).message });
    // Preflight 失败不是致命错误 — 跳过预检，让下载阶段处理
    return { isPdf: false, contentType: null, extractedPdfUrls: [], durationMs: Date.now() - start };
  }
}

// ─── Helpers ───

function parseContentType(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const ct = headers['content-type'];
  if (!ct) return null;
  const value = Array.isArray(ct) ? ct[0] : ct;
  return value?.toLowerCase() ?? null;
}
