import type {
  MemoId,
  PaperId,
  ConceptId,
  AnnotationId,
  OutlineEntryId,
  NoteId,
} from './common';

// ═══ ResearchMemo ═══

export interface ResearchMemo {
  id: MemoId;
  text: string; // 非空
  paperIds: PaperId[];
  conceptIds: ConceptId[];
  annotationId: AnnotationId | null;
  outlineId: OutlineEntryId | null;
  linkedNoteIds: NoteId[];
  tags: string[];
  indexed: boolean; // chunk 索引是否就绪
  createdAt: string; // ISO 8601
  updatedAt: string;
}
