import type { PaperMetadata, Annotation, ConceptMapping, ConceptDefinition } from '../types';

// ═══ Paper CRUD ═══

export function addPaper(paper: PaperMetadata): void {
  throw new Error('Not implemented');
}

export function updatePaper(id: string, updates: Partial<PaperMetadata>): void {
  throw new Error('Not implemented');
}

export function getPaper(id: string): PaperMetadata | null {
  throw new Error('Not implemented');
}

export function queryPapers(filter: Record<string, unknown>): PaperMetadata[] {
  throw new Error('Not implemented');
}

// ═══ Citations ═══

export function addCitation(citingId: string, citedId: string): void {
  throw new Error('Not implemented');
}

// ═══ Concepts ═══

export function syncConcepts(concepts: ConceptDefinition[]): void {
  throw new Error('Not implemented');
}

export function mapPaperConcept(paperId: string, mapping: ConceptMapping): void {
  throw new Error('Not implemented');
}

// ═══ Annotations ═══

export function addAnnotation(annotation: Annotation): number {
  throw new Error('Not implemented');
}

export function getAnnotations(paperId: string): Annotation[] {
  throw new Error('Not implemented');
}

// ═══ Graphs & Analytics ═══

export function getConceptMatrix(): Record<string, Record<string, unknown>> {
  throw new Error('Not implemented');
}

export function getCitationGraph(): { nodes: unknown[]; edges: unknown[] } {
  throw new Error('Not implemented');
}

export function getRelationGraph(): { nodes: unknown[]; edges: unknown[] } {
  throw new Error('Not implemented');
}

// ═══ Maintenance ═══

export function gcConceptChange(removedConceptIds: string[]): number {
  throw new Error('Not implemented');
}

export function getStats(): Record<string, number> {
  throw new Error('Not implemented');
}

export function checkIntegrity(): { ok: boolean; issues: string[] } {
  throw new Error('Not implemented');
}

export function exportCsv(tableName: string): string {
  throw new Error('Not implemented');
}
