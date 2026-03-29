import type { ConceptId } from './common';
import type {
  Maturity as ConceptMaturity,
  ConceptHistoryEventType,
} from '../../shared-types/enums';

// ═══ 字面量联合 + const 数组 ═══
// 唯一定义源在 shared-types/enums，此处 re-export 并提供 const 数组用于运行时校验。

export type { ConceptMaturity };

export const CONCEPT_MATURITIES = [
  'tentative',
  'working',
  'established',
] as const;

/** @deprecated 使用 ConceptHistoryEventType 代替 */
export type ConceptChangeType = ConceptHistoryEventType;
export type { ConceptHistoryEventType };

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

// ═══ ConceptHistoryEntry ═══

export interface ConceptHistoryEntry {
  timestamp: string; // ISO 8601
  changeType: ConceptHistoryEventType;
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
