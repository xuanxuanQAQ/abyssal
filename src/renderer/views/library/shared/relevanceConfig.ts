/**
 * Relevance 选项配置 — Library 模块统一定义
 *
 * 替代 RelevanceCell / BatchActionBar / RowContextMenu 中的重复定义。
 */

import type { Relevance } from '../../../../shared-types/enums';

export interface RelevanceOption {
  value: Relevance;
  label: string;
  color: string;
}

export const RELEVANCE_CONFIG: RelevanceOption[] = [
  { value: 'seed', label: 'Seed', color: '#3B82F6' },
  { value: 'high', label: 'High', color: '#22C55E' },
  { value: 'medium', label: 'Medium', color: '#F59E0B' },
  { value: 'low', label: 'Low', color: '#9CA3AF' },
  { value: 'excluded', label: 'Excluded', color: '#EF4444' },
];

export function getRelevanceColor(relevance: Relevance): string {
  return RELEVANCE_CONFIG.find((c) => c.value === relevance)?.color ?? '#9CA3AF';
}
