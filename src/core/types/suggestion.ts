import type { SuggestionId, PaperId, ConceptId } from './common';

// ═══ 字面量联合 + const 数组 ═══

export const SUGGESTION_STATUSES = [
  'pending',
  'adopted',
  'dismissed',
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

// ═══ SuggestedConcept ═══

export interface SuggestedConcept {
  id: SuggestionId;
  term: string;
  termNormalized: string; // term.trim().toLowerCase()
  frequency: number;
  sourcePaperIds: PaperId[];
  sourcePaperCount: number; // sourcePaperIds.length 冗余存储
  closestExistingConceptId: ConceptId | null;
  closestExistingConceptSimilarity: string | null; // AI 生成的关系描述
  reason: string;
  suggestedDefinition: string | null;
  suggestedKeywords: string[];
  status: SuggestionStatus;
  adoptedConceptId: ConceptId | null;
  createdAt: string;
  updatedAt: string;
}
