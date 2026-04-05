import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Monitor, Languages, Eye } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { Section, Row, Select } from '../components/ui';
import { useTheme } from '../../../core/context/ThemeContext';
import { SUPPORTED_LOCALES, changeLocale } from '../../../i18n';
import type { SupportedLocale } from '../../../i18n';
import { setAuthorDisplayThreshold } from '../../../core/hooks/useAuthorDisplay';

export function PersonalizationTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
  const { t, i18n } = useTranslation();
  const { colorScheme, setColorScheme } = useTheme();
  const { language, personalization } = settings;
  const threshold = personalization?.authorDisplayThreshold ?? 1;

  const handleUiLocaleChange = async (locale: string) => {
    await changeLocale(locale as SupportedLocale);
    onUpdate('language', { uiLocale: locale });
  };

  return (
    <>
      <Section icon={<Sun size={16} />} title={t('settings.personalization.appearance')}>
        <Row label={t('settings.personalization.theme')} noBorder>
          <ThemeSelector value={colorScheme} onChange={setColorScheme} />
        </Row>
      </Section>

      <Section icon={<Languages size={16} />} title={t('settings.personalization.language')} description={t('settings.personalization.languageDesc')}>
        <Row label={t('settings.personalization.uiLanguage')} hint={t('settings.personalization.uiLanguageHint')}>
          <Select
            value={i18n.resolvedLanguage ?? i18n.language}
            options={SUPPORTED_LOCALES.map((l) => ({ value: l.code, label: l.label }))}
            onChange={handleUiLocaleChange}
            width={140}
          />
        </Row>
        <Row label={t('settings.personalization.defaultOutputLanguage')} noBorder>
          <Select
            value={language.defaultOutputLanguage}
            options={[
              { value: 'zh-CN', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(v) => onUpdate('language', { defaultOutputLanguage: v })}
            width={140}
          />
        </Row>
      </Section>

      <Section icon={<Eye size={16} />} title={t('settings.personalization.display')}>
        <Row label={t('settings.personalization.authorDisplayThreshold')} hint={t('settings.personalization.authorDisplayThresholdHint')} noBorder>
          <Select
            value={String(threshold)}
            options={[
              { value: '0', label: t('settings.personalization.authorShowAll') },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
            onChange={(v) => { const n = Number(v); setAuthorDisplayThreshold(n); onUpdate('personalization', { authorDisplayThreshold: n }); }}
            width={120}
          />
        </Row>
      </Section>
    </>
  );
}

function ThemeSelector({ value, onChange }: { value: string; onChange: (v: 'light' | 'dark' | 'system') => void }) {
  const { t } = useTranslation();
  const options: Array<{ value: 'light' | 'dark' | 'system'; icon: React.ReactNode; label: string }> = [
    { value: 'light', icon: <Sun size={14} />, label: t('settings.personalization.light') },
    { value: 'dark', icon: <Moon size={14} />, label: t('settings.personalization.dark') },
    { value: 'system', icon: <Monitor size={14} />, label: t('settings.personalization.system') },
  ];

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', fontSize: 12, border: 'none', borderRadius: 'var(--radius-sm, 4px)',
            cursor: 'pointer',
            background: value === opt.value ? 'var(--accent-color)' : 'var(--bg-surface-high, var(--bg-surface))',
            color: value === opt.value ? '#fff' : 'var(--text-secondary)',
          }}
        >
          {opt.icon} {opt.label}
        </button>
      ))}
    </div>
  );
}
