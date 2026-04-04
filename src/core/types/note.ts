import type { NoteId, PaperId, ConceptId } from './common';

// ═══ ResearchNote ═══

export interface ResearchNote {
  id: NoteId; // UUID v4
  filePath: string;     // legacy — no longer used by editor
  title: string;
  linkedPaperIds: PaperId[];
  linkedConceptIds: ConceptId[];
  tags: string[];
  documentJson: string | null;  // ProseMirror JSON (unified editor storage)
  createdAt: string; // ISO 8601
  updatedAt: string;
}
