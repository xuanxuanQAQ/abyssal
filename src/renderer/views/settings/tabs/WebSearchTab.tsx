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
  { value: 'google_scholar', label: 'Google Scholar (SerpAPI)' },
  { value: 'tavily_scholar', label: 'Tavily Scholar' },
  { value: 'baidu_xueshu', label: '百度学术' },
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
            onChange={(v) => onUpdate('discovery', { searchBackend: v as any })}
          />
        </Row>
      </Section>

      <Section icon={<BookOpen size={16} />} title={t('settings.academicSearch.chineseTitle', '中文文献搜索')} description={t('settings.academicSearch.chineseDesc', '启用后，搜索中文内容时自动路由到对应后端')}>
        <Row label="Google Scholar (SerpAPI)" hint={t('settings.academicSearch.googleScholarHint', '通过 SerpAPI 搜索 Google Scholar，中文覆盖极好。需要 SerpAPI key（免费100次/月）')}>
          <Toggle
            checked={disc.enableGoogleScholar}
            onChange={(v) => onUpdate('discovery', { enableGoogleScholar: v })}
          />
        </Row>
        <Row label="Tavily Scholar" hint={t('settings.academicSearch.tavilyScholarHint', '使用 Tavily 深度搜索学术网页，提取元数据。使用已配置的 Tavily API key')}>
          <Toggle
            checked={disc.enableTavilyScholar}
            onChange={(v) => onUpdate('discovery', { enableTavilyScholar: v })}
          />
        </Row>
        <Row label={t('settings.academicSearch.baiduXueshu', '百度学术')} hint={t('settings.academicSearch.baiduXueshuHint', '通过内置浏览器搜索百度学术，中文覆盖最全。无需 API key，首次使用需完成验证码')} noBorder>
          <Toggle
            checked={disc.enableBaiduXueshu}
            onChange={(v) => onUpdate('discovery', { enableBaiduXueshu: v })}
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
            <li><strong>Google Scholar (SerpAPI)</strong> — {t('settings.academicSearch.googleScholarDesc', '通过 SerpAPI 搜索 Google Scholar，中文文献覆盖极好，返回结构化元数据。需要 SerpAPI key（免费100次/月）')}</li>
            <li><strong>Tavily Scholar</strong> — {t('settings.academicSearch.tavilyScholarDesc', '使用 Tavily 深度搜索学术网页，从知网/万方等页面提取元数据。需要 Tavily API key')}</li>
            <li><strong>百度学术</strong> — {t('settings.academicSearch.baiduXueshuDesc', '通过内置浏览器搜索百度学术，中文文献覆盖最全，返回标题/作者/期刊/年份/摘要。首次使用需完成一次验证码')}</li>
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
