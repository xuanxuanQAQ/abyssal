// ═══ Level 4: Institutional Proxy ═══
// §6.6: 通过机构代理下载

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt, makeFailedAttempt } from '../attempt-utils';

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
      return makeAttempt('institutional', 'failed', Date.now() - start, {
        failureReason: validation.reason ?? 'PDF validation failed',
        failureCategory: 'invalid_pdf',
      });
    }

    return makeAttempt('institutional', 'success', Date.now() - start, { httpStatus: 200 });
  } catch (err) {
    deleteFileIfExists(tempPath);
    return makeFailedAttempt('institutional', start, err);
  }
}
