import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, BookOpen, Info } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { Section, Row, Select, Toggle } from '../components/ui';

const ACADEMIC_SEARCH_BACKENDS = [
  { value: 'openalex', label: 'OpenAlex' },
  { value: 'semantic_scholar', label: 'Semantic Scholar' },
  { value: 'arxiv', label: 'arXiv' },
] as const;

const WEB_SEARCH_BACKENDS = [
  { value: 'bocha', label: 'Bocha (博查)' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'serpapi', label: 'SerpAPI (Google)' },
  { value: 'bing', label: 'Bing Web Search' },
] as const;

export function WebSearchTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
  const { t } = useTranslation();
  const ws = settings.webSearch;
  const disc = settings.discovery;

  return (
    <>
      <Section icon={<BookOpen size={16} />} title={t('settings.academicSearch.title')} description={t('settings.academicSearch.titleDesc')}>
        <Row label={t('settings.academicSearch.backend')} hint={t('settings.academicSearch.backendHint')} noBorder>
          <Select
            value={disc.searchBackend}
            options={ACADEMIC_SEARCH_BACKENDS.map((b) => ({ value: b.value, label: b.label }))}
            onChange={(v) => onUpdate('discovery', { searchBackend: v as 'openalex' | 'semantic_scholar' | 'arxiv' })}
          />
        </Row>
      </Section>

      <Section icon={<Info size={16} />} title={t('settings.academicSearch.about')}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>{t('settings.academicSearch.aboutDesc')}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>OpenAlex</strong> — {t('settings.academicSearch.openalexDesc')}</li>
            <li><strong>Semantic Scholar</strong> — {t('settings.academicSearch.semanticScholarDesc')}</li>
            <li><strong>arXiv</strong> — {t('settings.academicSearch.arxivDesc')}</li>
          </ul>
        </div>
      </Section>

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
            onChange={(v) => onUpdate('webSearch', { backend: v as 'tavily' | 'serpapi' | 'bing' | 'bocha' })}
          />
        </Row>
      </Section>

      <Section icon={<Info size={16} />} title={t('settings.webSearch.about')}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>{t('settings.webSearch.aboutDesc')}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Bocha (博查)</strong> — {t('settings.webSearch.bochaDesc')}</li>
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
