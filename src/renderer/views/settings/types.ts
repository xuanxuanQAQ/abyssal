import type React from 'react';
import type { SettingsData } from '../../../shared-types/models';

export type SettingsSectionKey = keyof SettingsData;

/**
 * Typed update callback — ensures section name and patch shape
 * are consistent with the SettingsData definition.
 */
export type UpdateSectionFn = <K extends SettingsSectionKey>(
  section: K,
  patch: Partial<SettingsData[K]>,
) => void;

export type TabId =
  | 'ai-models'
  | 'retrieval'
  | 'acquisition'
  | 'analysis'
  | 'web-search'
  | 'api-keys'
  | 'database'
  | 'project'
  | 'personalization'
  | 'about';

export interface TabDef {
  id: TabId;
  labelKey: string;
  icon: React.ReactNode;
}
