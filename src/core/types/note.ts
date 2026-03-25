import type { NoteId, PaperId, ConceptId } from './common';

// ═══ ResearchNote ═══

export interface ResearchNote {
  id: NoteId; // UUID v4
  filePath: string; // 相对于 workspace/notes/
  title: string;
  linkedPaperIds: PaperId[];
  linkedConceptIds: ConceptId[];
  tags: string[];
  createdAt: string; // ISO 8601
  updatedAt: string;
}
