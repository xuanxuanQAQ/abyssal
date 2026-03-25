// ═══ Level 4: Institutional Proxy ═══
// §6.6: 通过机构代理下载

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';

export async function tryInstitutional(
  http: HttpClient,
  doi: string,
  proxyUrlTemplate: string,
  tempPath: string,
  timeoutMs: number,
): Promise<AcquireAttempt> {
  const start = Date.now();

  try {
    // {doi} 占位符替换
    const url = proxyUrlTemplate.replace('{doi}', doi);

    await downloadPdf(http, url, tempPath, timeoutMs);
    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return {
        source: 'institutional',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: validation.reason ?? 'PDF validation failed',
        httpStatus: null,
      };
    }

    return {
      source: 'institutional',
      status: 'success',
      durationMs: Date.now() - start,
      failureReason: null,
      httpStatus: 200,
    };
  } catch (err) {
    deleteFileIfExists(tempPath);
    return {
      source: 'institutional',
      status: 'failed',
      durationMs: Date.now() - start,
      failureReason: (err as Error).message,
      httpStatus: null,
    };
  }
}
