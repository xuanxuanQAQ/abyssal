/**
 * useSettingsEditor — centralized settings state and persistence logic.
 *
 * Improvements over the previous inline approach:
 * - Typed updateSection (section key + patch shape are compile-time checked)
 * - Save failure semantics: pending cleared AFTER successful write, not before
 * - Rollback: on save failure, reloads from backend to restore true state
 * - Exposed `saving` / `loadError` states for UI feedback
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import type { SettingsData } from '../../../../shared-types/models';
import { getAPI } from '../../../core/ipc/bridge';
import type { SettingsSectionKey, UpdateSectionFn } from '../types';

interface SettingsEditorState {
  settings: SettingsData | null;
  loading: boolean;
  loadError: string | null;
  saving: boolean;
}

export function useSettingsEditor() {
  const { t } = useTranslation();
  const [state, setState] = useState<SettingsEditorState>({
    settings: null,
    loading: true,
    loadError: null,
    saving: false,
  });

  const isMountedRef = useRef(true);
  const pendingRef = useRef<Partial<Record<SettingsSectionKey, Record<string, unknown>>>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, loadError: null }));
    try {
      const data = await getAPI().settings.getAll();
      if (isMountedRef.current) {
        setState({ settings: data, loading: false, loadError: null, saving: false });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setState((s) => ({
          ...s,
          loading: false,
          loadError: (err as Error).message ?? t('settings.loadFailed'),
        }));
      }
    }
  }, [t]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const flushSaveRef = useRef<((skipStateUpdate?: boolean) => Promise<void>) | undefined>(undefined);

  const flushSave = useCallback(
    async (skipStateUpdate = false) => {
      // Clone pending — do NOT clear the original until success
      const batched = { ...pendingRef.current };
      const sections = Object.entries(batched);
      if (sections.length === 0) return;

      if (!skipStateUpdate && isMountedRef.current) {
        setState((s) => ({ ...s, saving: true }));
      }

      try {
        for (const [section, patch] of sections) {
          await getAPI().settings.updateSection(section, patch);
        }
        // Clear only the sections we successfully wrote
        for (const key of Object.keys(batched)) {
          delete pendingRef.current[key as SettingsSectionKey];
        }
        if (!skipStateUpdate) {
          toast.success(t('settings.saved'));
        }
      } catch (err) {
        pendingRef.current = {};
        // Reload from backend to restore true state (rollback)
        if (isMountedRef.current) {
          try {
            const data = await getAPI().settings.getAll();
            setState((s) => ({ ...s, settings: data }));
          } catch {
            // If reload also fails, keep current state
          }
        }
        toast.error(t('settings.saveFailed', { message: (err as Error).message }));
      } finally {
        if (!skipStateUpdate && isMountedRef.current) {
          setState((s) => ({ ...s, saving: false }));
        }
      }
    },
    [t],
  );

  // Keep ref in sync so cleanup always calls the latest flushSave
  flushSaveRef.current = flushSave;

  // Cleanup on unmount only (stable deps — no re-run on language change)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (Object.keys(pendingRef.current).length > 0) {
        void flushSaveRef.current?.(true);
      }
    };
  }, []);

  const updateSection = useCallback(
    (section: SettingsSectionKey, patch: Record<string, unknown>) => {
      // Optimistic UI update — fully typed at call sites via UpdateSectionFn
      setState((s) => {
        if (!s.settings) return s;
        return {
          ...s,
          settings: {
            ...s.settings,
            [section]: { ...s.settings[section], ...patch },
          },
        };
      });
      // Accumulate patch
      pendingRef.current[section] = { ...pendingRef.current[section], ...patch };
      // Reset debounce timer
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushSave();
      }, 600);
    },
    [flushSave],
  ) as UpdateSectionFn;

  return {
    settings: state.settings,
    loading: state.loading,
    loadError: state.loadError,
    saving: state.saving,
    loadSettings,
    updateSection,
  };
}
