import type { TextChunk, RankedChunk } from '../types';

export async function indexChunks(chunks: TextChunk[]): Promise<void> {
  throw new Error('Not implemented');
}

export async function indexPrivateDoc(docPath: string): Promise<void> {
  throw new Error('Not implemented');
}

export async function searchSemantic(query: string, topK?: number): Promise<RankedChunk[]> {
  throw new Error('Not implemented');
}

export async function searchByConcept(conceptId: string, topK?: number): Promise<RankedChunk[]> {
  throw new Error('Not implemented');
}

export async function searchSimilar(paperId: string, topK?: number): Promise<RankedChunk[]> {
  throw new Error('Not implemented');
}

export function getIndexStats(): { totalChunks: number; totalPapers: number; totalPrivateDocs: number } {
  throw new Error('Not implemented');
}
