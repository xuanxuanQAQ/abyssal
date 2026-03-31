// ═══ Level 2: arXiv PDF ═══
// §6.4: 直链下载 arXiv PDF

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt, makeFailedAttempt } from '../attempt-utils';

export async function tryArxivPdf(
  http: HttpClient,
  arxivId: string,
  tempPath: string,
  timeoutMs: number,
): Promise<AcquireAttempt> {
  const start = Date.now();

  try {
    const url = `https://arxiv.org/pdf/${arxivId}.pdf`;

    await downloadPdf(http, url, tempPath, timeoutMs);
    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return makeAttempt('arxiv', 'failed', Date.now() - start, {
        failureReason: validation.reason ?? 'PDF validation failed',
        failureCategory: 'invalid_pdf',
      });
    }

    return makeAttempt('arxiv', 'success', Date.now() - start, { httpStatus: 200 });
  } catch (err) {
    deleteFileIfExists(tempPath);
    return makeFailedAttempt('arxiv', start, err);
  }
}
