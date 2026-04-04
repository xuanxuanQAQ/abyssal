// ═══ Level 1: Unpaywall ═══
// §6.3: 通过 DOI 查询 OA PDF 链接

import type { AcquireAttempt } from '../types';
import type { HttpClient } from '../../infra/http-client';
import type { RateLimiter } from '../../infra/rate-limiter';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt, makeFailedAttempt } from '../attempt-utils';

const UNPAYWALL_API = 'https://api.unpaywall.org/v2';

export async function tryUnpaywall(
  http: HttpClient,
  limiter: RateLimiter,
  doi: string,
  email: string,
  tempPath: string,
  timeoutMs: number,
): Promise<AcquireAttempt> {
  const start = Date.now();

  try {
    await limiter.acquire();

    // DOI 中的 '/' 是路径分隔符，不能被编码为 %2F；只编码其他特殊字符
    const encodedDoi = doi.split('/').map(encodeURIComponent).join('/');
    const url = `${UNPAYWALL_API}/${encodedDoi}?email=${encodeURIComponent(email)}`;
    const data = await http.requestJson<{
      best_oa_location?: {
        url_for_pdf?: string | null;
        url?: string | null;
      } | null;
    }>(url, { timeoutMs });

    const pdfUrl = data.best_oa_location?.url_for_pdf;
    if (!pdfUrl) {
      return makeAttempt('unpaywall', 'failed', Date.now() - start, {
        failureReason: 'No PDF URL in Unpaywall response',
        failureCategory: 'no_pdf_url',
      });
    }

    await downloadPdf(http, pdfUrl, tempPath, timeoutMs);
    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return makeAttempt('unpaywall', 'failed', Date.now() - start, {
        failureReason: validation.reason ?? 'PDF validation failed',
        failureCategory: 'invalid_pdf',
      });
    }

    return makeAttempt('unpaywall', 'success', Date.now() - start, { httpStatus: 200 });
  } catch (err) {
    deleteFileIfExists(tempPath);
    return makeFailedAttempt('unpaywall', start, err);
  }
}
