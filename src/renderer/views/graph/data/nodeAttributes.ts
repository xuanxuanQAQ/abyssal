import type { Maturity } from '../../../../shared-types/enums';

export const BASE_SIZE = 5;
export const LOG_SCALE = 3;
export const MIN_SIZE = 4;
export const MAX_SIZE = 24;
export const CONCEPT_SIZE = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeNodeSize(
  type: 'paper' | 'concept' | 'memo' | 'note',
  citationCount?: number,
  maturity?: Maturity,
): number {
  if (type === 'concept') {
    if (maturity === 'tentative') return CONCEPT_SIZE * 0.8;
    if (maturity === 'established') return CONCEPT_SIZE * 1.3;
    return CONCEPT_SIZE;
  }
  if (type === 'memo' || type === 'note') {
    return CONCEPT_SIZE; // same size as concepts for now
  }
  return clamp(
    BASE_SIZE + LOG_SCALE * Math.log(1 + (citationCount ?? 0)),
    MIN_SIZE,
    MAX_SIZE,
  );
}

/** Returns true if a concept node with this maturity should be excluded from the graph. */
export function shouldSkipNode(type: string, maturity?: Maturity): boolean {
  return type === 'concept' && maturity === 'tag';
}

export const RELEVANCE_COLORS: Record<string, string> = {
  seed: '#3B82F6',
  high: '#22C55E',
  medium: '#F59E0B',
  low: '#6B7280',
  excluded: '#EF4444',
};

export const CONCEPT_LEVEL_COLORS: Record<number, string> = {
  0: '#8B5CF6',
  1: '#A78BFA',
};
export const DEFAULT_CONCEPT_COLOR = '#C4B5FD';

export const MEMO_COLOR = '#F59E0B';
export const NOTE_COLOR = '#14B8A6';

export function computeNodeColor(
  type: 'paper' | 'concept' | 'memo' | 'note',
  relevance?: string,
  level?: number,
): string {
  if (type === 'memo') return MEMO_COLOR;
  if (type === 'note') return NOTE_COLOR;
  if (type === 'concept') {
    if (level !== undefined && level in CONCEPT_LEVEL_COLORS) {
      return CONCEPT_LEVEL_COLORS[level] ?? DEFAULT_CONCEPT_COLOR;
    }
    return DEFAULT_CONCEPT_COLOR;
  }
  if (relevance !== undefined && relevance in RELEVANCE_COLORS) {
    return RELEVANCE_COLORS[relevance] ?? '#6B7280';
  }
  return RELEVANCE_COLORS['low'] ?? '#6B7280';
}

export function computeNodeOpacity(
  type: 'paper' | 'concept',
  relevance?: string,
  maturity?: Maturity,
): number {
  if (relevance === 'excluded') {
    return 0.5;
  }
  if (type === 'concept' && maturity === 'tentative') {
    return 0.4;
  }
  return 1.0;
}

/** Returns additional metadata for concept maturity styling. */
export function computeMaturityMeta(maturity?: Maturity): Record<string, unknown> {
  if (maturity === 'tentative') return { borderStyle: 'dashed' };
  if (maturity === 'established') return { glow: true };
  return {};
}
