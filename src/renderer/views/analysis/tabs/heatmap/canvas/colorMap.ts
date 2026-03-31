import type { RelationType } from '../../../../../../shared-types/enums';
import { RELATION_BASE_RGB } from '../../../shared/relationTheme';

const BASE_COLORS = RELATION_BASE_RGB;

const MIN_OPACITY = 0.15;
const QUANTIZE_STEPS = 20;

// Pre-computed cache: 4 types x 20 steps = 80 entries
const colorCache = new Map<string, string>();

function buildCache(): void {
  for (const [type, [r, g, b]] of Object.entries(BASE_COLORS)) {
    for (let step = 0; step <= QUANTIZE_STEPS; step++) {
      const confidence = step / QUANTIZE_STEPS;
      const alpha = MIN_OPACITY + confidence * (1.0 - MIN_OPACITY);
      const key = `${type}:${step}`;
      colorCache.set(key, `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
    }
  }
}
buildCache();

export function getCellColor(relationType: RelationType, confidence: number): string {
  const step = Math.round(confidence * QUANTIZE_STEPS);
  const key = `${relationType}:${step}`;
  return colorCache.get(key) ?? 'rgba(156,163,175,0.15)';
}

// Pre-computed Uint32 cache for ImageData direct-write (ABGR byte order)
const uint32Cache = new Map<string, number>();

function buildUint32Cache(): void {
  for (const [type, [r, g, b]] of Object.entries(BASE_COLORS)) {
    for (let step = 0; step <= QUANTIZE_STEPS; step++) {
      const confidence = step / QUANTIZE_STEPS;
      const alpha = Math.round((MIN_OPACITY + confidence * (1.0 - MIN_OPACITY)) * 255);
      const key = `${type}:${step}`;
      // ABGR byte order for Uint32Array over ImageData
      uint32Cache.set(key, (alpha << 24) | (b << 16) | (g << 8) | r);
    }
  }
}
buildUint32Cache();

export function getCellColorUint32(relationType: RelationType, confidence: number): number {
  const step = Math.round(confidence * QUANTIZE_STEPS);
  const key = `${relationType}:${step}`;
  return uint32Cache.get(key) ?? 0x26AFA39C; // fallback gray: rgba(156,163,175,0.15) in ABGR
}

export function getBaseColor(relationType: RelationType): string {
  const [r, g, b] = BASE_COLORS[relationType] ?? [156, 163, 175];
  return `rgb(${r},${g},${b})`;
}
