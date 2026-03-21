import type { AcquireResult } from '../types';

export async function acquireFulltext(doi: string): Promise<AcquireResult> {
  throw new Error('Not implemented');
}

export async function tryUnpaywall(doi: string): Promise<string | null> {
  throw new Error('Not implemented');
}

export async function tryArxivPdf(arxivId: string): Promise<string | null> {
  throw new Error('Not implemented');
}

export async function tryPmc(doi: string): Promise<string | null> {
  throw new Error('Not implemented');
}

export async function tryScihub(doi: string): Promise<string | null> {
  throw new Error('Not implemented');
}

export async function downloadPdf(url: string, savePath: string): Promise<string> {
  throw new Error('Not implemented');
}
