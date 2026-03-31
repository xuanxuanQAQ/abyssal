/**
 * ConfigProvider — centralized, observable configuration holder.
 *
 * All runtime modules read config through this provider instead of holding
 * their own snapshots. When settings change, ConfigProvider emits granular
 * change events so downstream modules can rebuild internal state.
 *
 * Replaces the old pattern of `(ctx as any).config = newConfig` +
 * stale references in ModelRouter / LlmClient / RerankerScheduler.
 */

import type { AbyssalConfig } from '../types/config';

// ─── Change event ───

export interface ConfigChangeEvent {
  /** Top-level section names that changed (e.g. ['llm', 'apiKeys']) */
  changedSections: string[];
  /** Previous config snapshot */
  previous: AbyssalConfig;
  /** New config snapshot */
  current: AbyssalConfig;
}

export type ConfigChangeListener = (event: ConfigChangeEvent) => void;

// ─── ConfigProvider ───

export class ConfigProvider {
  private _config: AbyssalConfig;
  private readonly listeners: Set<ConfigChangeListener> = new Set();

  constructor(initial: AbyssalConfig) {
    this._config = initial;
  }

  /** Current config (always up-to-date). */
  get config(): AbyssalConfig {
    return this._config;
  }

  /**
   * Replace config with a new snapshot and notify listeners.
   * Performs shallow diff on top-level keys to determine changedSections.
   */
  update(newConfig: AbyssalConfig): void {
    const previous = this._config;
    const changedSections = diffTopLevelKeys(previous, newConfig);

    this._config = newConfig;

    if (changedSections.length > 0) {
      const event: ConfigChangeEvent = { changedSections, previous, current: newConfig };
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // Listener errors must not break the update chain
        }
      }
    }
  }

  /** Subscribe to config changes. Returns an unsubscribe function. */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

// ─── Helpers ───

/** Shallow-compare top-level config sections by reference identity. */
function diffTopLevelKeys(a: AbyssalConfig, b: AbyssalConfig): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    const aVal = (a as unknown as Record<string, unknown>)[key];
    const bVal = (b as unknown as Record<string, unknown>)[key];
    if (aVal !== bVal) {
      // Deep compare for objects (config sections are small, frozen objects)
      if (
        typeof aVal === 'object' && aVal !== null &&
        typeof bVal === 'object' && bVal !== null &&
        JSON.stringify(aVal) === JSON.stringify(bVal)
      ) {
        continue;
      }
      changed.push(key);
    }
  }
  return changed;
}
