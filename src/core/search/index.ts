import type { PaperMetadata, CitationDirection } from '../types';

export async function searchSemanticScholar(query: string, limit: number): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}

export async function searchOpenAlex(concepts: string[], limit: number): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}

export async function searchArxiv(query: string, limit: number): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}

export async function getPaperDetails(paperId: string): Promise<PaperMetadata> {
  throw new Error('Not implemented');
}

export async function getCitations(paperId: string, direction: CitationDirection): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}

export async function getRelatedPapers(paperId: string, limit: number): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}

export async function searchByAuthor(authorName: string): Promise<PaperMetadata[]> {
  throw new Error('Not implemented');
}
