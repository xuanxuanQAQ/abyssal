import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Info } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { Section, Row, Select, Toggle } from '../components/ui';

const WEB_SEARCH_BACKENDS = [
  { value: 'tavily', label: 'Tavily' },
  { value: 'serpapi', label: 'SerpAPI (Google)' },
  { value: 'bing', label: 'Bing Web Search' },
] as const;

export function WebSearchTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
  const { t } = useTranslation();
  const ws = settings.webSearch;

  return (
    <>
      <Section icon={<Globe size={16} />} title={t('settings.webSearch.title')} description={t('settings.webSearch.titleDesc')}>
        <Row label={t('settings.webSearch.enabled')} hint={t('settings.webSearch.enabledHint')}>
          <Toggle
            checked={ws.enabled}
            onChange={(v) => onUpdate('webSearch', { enabled: v })}
          />
        </Row>
        <Row label={t('settings.webSearch.backend')} hint={t('settings.webSearch.backendHint')} noBorder>
          <Select
            value={ws.backend}
            options={WEB_SEARCH_BACKENDS.map((b) => ({ value: b.value, label: b.label }))}
            onChange={(v) => onUpdate('webSearch', { backend: v as 'tavily' | 'serpapi' | 'bing' })}
          />
        </Row>
      </Section>

      <Section icon={<Info size={16} />} title={t('settings.webSearch.about')}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>{t('settings.webSearch.aboutDesc')}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Tavily</strong> — {t('settings.webSearch.tavilyDesc')}</li>
            <li><strong>SerpAPI</strong> — {t('settings.webSearch.serpapiDesc')}</li>
            <li><strong>Bing</strong> — {t('settings.webSearch.bingDesc')}</li>
          </ul>
          <p style={{ margin: '8px 0 0', color: 'var(--text-tertiary)' }}>{t('settings.webSearch.apiKeyNote')}</p>
        </div>
      </Section>
    </>
  );
}
