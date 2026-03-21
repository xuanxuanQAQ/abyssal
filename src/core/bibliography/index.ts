import type { PaperMetadata } from '../types';

export async function enrichBibliography(paperId: string): Promise<void> {
  throw new Error('Not implemented');
}

export async function importBibtex(bibtexString: string): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}

export async function importRis(risString: string): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}

export function exportBibtex(paperIds: string[]): string {
  throw new Error('Not implemented');
}

export function exportRis(paperIds: string[]): string {
  throw new Error('Not implemented');
}

export function formatCitation(paperId: string, style: string): string {
  throw new Error('Not implemented');
}

export function formatBibliography(paperIds: string[], style: string): string {
  throw new Error('Not implemented');
}

export function checkBiblioCompleteness(paperId: string): { complete: boolean; missing: string[] } {
  throw new Error('Not implemented');
}
