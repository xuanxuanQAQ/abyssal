import type { PaperId, ConceptId, ChunkId, AnnotationId } from './common';
import type { RelationType } from '../../shared-types/enums';

// ═══ 字面量联合 + const 数组 ═══

export type { RelationType };
export const RELATION_TYPES = [
  'supports',
  'challenges',
  'extends',
  'operationalizes',
  'irrelevant',
] as const;

export const REVIEW_STATUSES = [
  'pending',
  'accepted',
  'revised',
  'rejected',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// ═══ BilingualEvidence ═══

export interface BilingualEvidence {
  en: string;
  original: string;
  originalLang: string; // BCP 47, e.g. "zh-CN", "en", "ja"
  chunkId: ChunkId | null;
  page: number | null;
  annotationId: AnnotationId | null;
}

// ═══ ConceptMapping ═══

export interface ConceptMapping {
  paperId: PaperId;
  conceptId: ConceptId;
  relation: RelationType;
  confidence: number; // [0.0, 1.0]
  evidence: BilingualEvidence;
  annotationId: AnnotationId | null;
  reviewed: boolean;
  reviewedAt: string | null;
}
