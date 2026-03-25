import type { PaperId } from './common';

// ═══ 字面量联合 + const 数组 ═══

export const RELATION_EDGE_TYPES = [
  'semantic_neighbor',
  'concept_agree',
  'concept_conflict',
  'concept_extend',
  'article_cites',
] as const;
export type RelationEdgeType = (typeof RELATION_EDGE_TYPES)[number];

// ═══ PaperRelation ═══

export interface PaperRelation {
  sourcePaperId: PaperId;
  targetPaperId: PaperId;
  edgeType: RelationEdgeType;
  weight: number; // [0.0, 1.0]
  metadata: Record<string, unknown> | null;
  computedAt: string; // ISO 8601
}
