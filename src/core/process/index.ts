import type { TextChunk, FigureBlock, Annotation, RefMetadata } from '../types';

export async function extractText(pdfPath: string): Promise<{ text: string; pageCount: number; method: string }> {
  throw new Error('Not implemented');
}

export async function extractFigures(pdfPath: string, pages?: number[]): Promise<FigureBlock[]> {
  throw new Error('Not implemented');
}

export function extractSections(text: string): Record<string, string> {
  throw new Error('Not implemented');
}

export function extractReferences(text: string): RefMetadata[] {
  throw new Error('Not implemented');
}

export function chunkText(text: string, maxTokens: number): TextChunk[] {
  throw new Error('Not implemented');
}

export async function readAnnotations(pdfPath: string): Promise<Annotation[]> {
  throw new Error('Not implemented');
}

export async function writeAnnotation(pdfPath: string, annotation: Annotation): Promise<void> {
  throw new Error('Not implemented');
}
