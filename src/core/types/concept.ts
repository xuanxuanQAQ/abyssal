import type { ConceptId } from './common';

// ═══ 字面量联合 + const 数组 ═══

export const CONCEPT_MATURITIES = [
  'tentative',
  'working',
  'established',
] as const;
export type ConceptMaturity = (typeof CONCEPT_MATURITIES)[number];

export const CONCEPT_CHANGE_TYPES = [
  'created',
  'definition_refined',
  'keywords_added',
  'keywords_removed',
  'maturity_upgraded',
  'maturity_downgraded',
  'layer_changed',
  'parent_changed',
  'merged_from',
  'split_into',
  'deprecated',
] as const;
export type ConceptChangeType = (typeof CONCEPT_CHANGE_TYPES)[number];

// ═══ ConceptHistoryEntry ═══

export interface ConceptHistoryEntry {
  timestamp: string; // ISO 8601
  changeType: ConceptChangeType;
  oldValueSummary: string; // 截断到前 200 字符，created 类型为 ""
  reason: string | null;
  isBreaking: boolean;
  metadata: Record<string, unknown> | null;
}

// ═══ ConceptDefinition ═══

export interface ConceptDefinition {
  id: ConceptId;
  nameZh: string;
  nameEn: string;
  layer: string;
  definition: string;
  searchKeywords: string[];
  maturity: ConceptMaturity;
  parentId: ConceptId | null;
  history: ConceptHistoryEntry[];
  deprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  createdAt: string; // ISO 8601
}
