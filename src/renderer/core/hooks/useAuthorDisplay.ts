/**
 * useAuthorDisplay — reads the author display threshold from localStorage.
 *
 * The threshold controls when "et al." is shown:
 *   0  → always show all authors
 *   N  → show "et al." when author count > N
 *
 * Written by SettingsView (PersonalizationTab) via `settings:updateSection`,
 * and also synced to localStorage for instant renderer-side access.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'abyssal-author-display-threshold';
const DEFAULT_THRESHOLD = 1;

let listeners: Array<() => void> = [];

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function getSnapshot(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_THRESHOLD;
}

export function setAuthorDisplayThreshold(value: number): void {
  localStorage.setItem(STORAGE_KEY, String(value));
  listeners.forEach((l) => l());
}

/** Returns the current threshold (0 = show all, N = et al. when > N) */
export function useAuthorDisplayThreshold(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Format an author list respecting the threshold.
 * Returns a shortened string like "Smith et al." or the full list joined.
 */
export function formatAuthorShort(
  names: string[],
  threshold: number,
  etAlSuffix = ' et al.',
): string {
  if (!names.length) return '';
  if (threshold === 0 || names.length <= threshold) {
    return names.length <= 2 ? names.join(' & ') : names.join(', ');
  }
  return `${names[0]}${etAlSuffix}`;
}
