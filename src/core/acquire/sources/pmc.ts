// ═══ Level 3: PubMed Central ═══
// §6.5: PMCID 直链或 DOI → PMCID 转换后下载

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';

const PMC_PDF_BASE = 'https://www.ncbi.nlm.nih.gov/pmc/articles';
const ID_CONVERTER = 'https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/';

export async function tryPmc(
  http: HttpClient,
  doi: string | null,
  pmcid: string | null,
  tempPath: string,
  timeoutMs: number,
): Promise<AcquireAttempt> {
  const start = Date.now();

  try {
    let effectivePmcid = pmcid;

    // DOI → PMCID 转换
    if (!effectivePmcid && doi) {
      const converterUrl = `${ID_CONVERTER}?ids=${encodeURIComponent(doi)}&format=json`;
      const data = await http.requestJson<{
        records?: Array<{ pmcid?: string | undefined }> | undefined;
      }>(converterUrl, { timeoutMs });

      effectivePmcid = data.records?.[0]?.pmcid ?? null;
    }

    if (!effectivePmcid) {
      return {
        source: 'pmc',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: 'No PMCID available',
        httpStatus: null,
      };
    }

    const pdfUrl = `${PMC_PDF_BASE}/${effectivePmcid}/pdf/`;

    await downloadPdf(http, pdfUrl, tempPath, timeoutMs);
    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return {
        source: 'pmc',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: validation.reason ?? 'PDF validation failed',
        httpStatus: null,
      };
    }

    return {
      source: 'pmc',
      status: 'success',
      durationMs: Date.now() - start,
      failureReason: null,
      httpStatus: 200,
    };
  } catch (err) {
    deleteFileIfExists(tempPath);
    return {
      source: 'pmc',
      status: 'failed',
      durationMs: Date.now() - start,
      failureReason: (err as Error).message,
      httpStatus: null,
    };
  }
}
