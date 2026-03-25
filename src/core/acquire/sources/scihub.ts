// ═══ Level 5: Sci-Hub ═══
// §6.7: 从 HTML 页面提取 PDF URL

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';

// 从 Sci-Hub HTML 提取 PDF URL
// 策略：优先匹配 type="application/pdf" 或 id="pdf" 的 embed/iframe，
// 再回退到任意 embed/iframe 的 src 属性
const PDF_PATTERNS: RegExp[] = [
  // type="application/pdf" 的 embed
  /embed[^>]+type\s*=\s*"application\/pdf"[^>]+src\s*=\s*"([^"]+)"/i,
  // id="pdf" 的 iframe/embed
  /(?:iframe|embed)[^>]+id\s*=\s*"pdf"[^>]+src\s*=\s*"([^"]+)"/i,
  // src 含 .pdf 的 iframe/embed
  /(?:iframe|embed)[^>]+src\s*=\s*"([^"]*\.pdf[^"]*)"/i,
  // 最宽泛：任意 iframe/embed 的 src（兜底——Sci-Hub 动态端点可能无 .pdf 后缀）
  /(?:iframe|embed)[^>]+src\s*=\s*"([^"]+)"/i,
];

function extractPdfUrl(html: string, domain: string): string | null {
  for (const pattern of PDF_PATTERNS) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      let url = match[1];
      // 协议相对 URL
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }
      // 相对路径
      if (url.startsWith('/')) {
        url = `https://${domain}${url}`;
      }
      return url;
    }
  }
  return null;
}

export async function tryScihub(
  http: HttpClient,
  doi: string,
  domain: string,
  tempPath: string,
  timeoutMs: number,
): Promise<AcquireAttempt> {
  const start = Date.now();

  try {
    // 步骤 1：获取 Sci-Hub HTML 页面
    const pageUrl = `https://${domain}/${doi}`;
    const response = await http.request(pageUrl, { timeoutMs });

    // 步骤 2：提取 PDF URL
    const pdfUrl = extractPdfUrl(response.body, domain);
    if (!pdfUrl) {
      return {
        source: 'scihub',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: 'PDF URL extraction failed from Sci-Hub HTML',
        httpStatus: null,
      };
    }

    // 步骤 3：下载 PDF
    await downloadPdf(http, pdfUrl, tempPath, timeoutMs);
    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return {
        source: 'scihub',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: validation.reason ?? 'PDF validation failed',
        httpStatus: null,
      };
    }

    return {
      source: 'scihub',
      status: 'success',
      durationMs: Date.now() - start,
      failureReason: null,
      httpStatus: 200,
    };
  } catch (err) {
    deleteFileIfExists(tempPath);
    return {
      source: 'scihub',
      status: 'failed',
      durationMs: Date.now() - start,
      failureReason: (err as Error).message,
      httpStatus: null,
    };
  }
}
