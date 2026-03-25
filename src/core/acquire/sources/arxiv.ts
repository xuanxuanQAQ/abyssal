// ═══ Level 2: arXiv PDF ═══
// §6.4: 直链下载 arXiv PDF

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';

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
      return {
        source: 'arxiv',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: validation.reason ?? 'PDF validation failed',
        httpStatus: null,
      };
    }

    return {
      source: 'arxiv',
      status: 'success',
      durationMs: Date.now() - start,
      failureReason: null,
      httpStatus: 200,
    };
  } catch (err) {
    deleteFileIfExists(tempPath);
    return {
      source: 'arxiv',
      status: 'failed',
      durationMs: Date.now() - start,
      failureReason: (err as Error).message,
      httpStatus: null,
    };
  }
}
