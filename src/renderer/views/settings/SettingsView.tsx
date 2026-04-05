/**
 * SettingsView — full application configuration panel.
 *
 * Thin shell: tab navigation + loading/error/saving states.
 * All tab content lives in ./tabs/, shared UI atoms in ./components/ui.tsx,
 * and save orchestration in ./hooks/useSettingsEditor.ts.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cpu, Key, FolderOpen, Info, Database, Search, Download,
  FileText, Loader2, Palette, Globe, AlertTriangle, RefreshCw,
} from 'lucide-react';
import type { TabId, TabDef } from './types';
import { useSettingsEditor } from './hooks/useSettingsEditor';
import { AiModelsTab } from './tabs/AiModelsTab';
import { RetrievalTab } from './tabs/RetrievalTab';
import { AcquisitionTab } from './tabs/AcquisitionTab';
import { AnalysisTab } from './tabs/AnalysisTab';
import { WebSearchTab } from './tabs/WebSearchTab';
import { ApiKeysTab } from './tabs/ApiKeysTab';
import { DatabaseTab } from './tabs/DatabaseTab';
import { ProjectTab } from './tabs/ProjectTab';
import { PersonalizationTab } from './tabs/PersonalizationTab';
import { AboutTab } from './tabs/AboutTab';

const TABS: TabDef[] = [
  { id: 'ai-models', labelKey: 'aiModels', icon: <Cpu size={15} /> },
  { id: 'retrieval', labelKey: 'retrieval', icon: <Search size={15} /> },
  { id: 'acquisition', labelKey: 'acquisition', icon: <Download size={15} /> },
  { id: 'analysis', labelKey: 'analysis', icon: <FileText size={15} /> },
  { id: 'web-search', labelKey: 'webSearch', icon: <Globe size={15} /> },
  { id: 'api-keys', labelKey: 'apiKeys', icon: <Key size={15} /> },
  { id: 'database', labelKey: 'database', icon: <Database size={15} /> },
  { id: 'project', labelKey: 'project', icon: <FolderOpen size={15} /> },
  { id: 'personalization', labelKey: 'personalization', icon: <Palette size={15} /> },
  { id: 'about', labelKey: 'about', icon: <Info size={15} /> },
];

export function SettingsView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('ai-models');
  const { settings, loading, loadError, saving, loadSettings, updateSection } = useSettingsEditor();

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left Tab Rail */}
      <nav style={{
        width: 200,
        minWidth: 200,
        borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface-lowest, var(--bg-base))',
        padding: '16px 0',
        overflowY: 'auto',
      }}>
        <div style={{
          padding: '0 16px 12px',
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          {t('settings.title')}
          {saving && (
            <span style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontWeight: 400,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              {t('settings.saving')}
            </span>
          )}
        </div>
        {TABS.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </nav>

      {/* Right Content Area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '24px 32px', maxWidth: 760 }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ marginTop: 8 }}>{t('settings.loading')}</p>
            </div>
          ) : loadError ? (
            <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>
              <AlertTriangle size={24} style={{ color: 'var(--danger, #ef4444)' }} />
              <p style={{ marginTop: 8, color: 'var(--danger, #ef4444)' }}>
                {t('settings.loadFailed')}: {loadError}
              </p>
              <button
                onClick={loadSettings}
                style={{
                  marginTop: 12, padding: '6px 16px', fontSize: 13,
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <RefreshCw size={14} /> {t('settings.retry')}
              </button>
            </div>
          ) : settings && (
            <>
              {activeTab === 'ai-models' && <AiModelsTab settings={settings} onUpdate={updateSection} />}
              {activeTab === 'retrieval' && <RetrievalTab settings={settings} onUpdate={updateSection} />}
              {activeTab === 'acquisition' && <AcquisitionTab settings={settings} onUpdate={updateSection} />}
              {activeTab === 'analysis' && <AnalysisTab settings={settings} onUpdate={updateSection} />}
              {activeTab === 'web-search' && <WebSearchTab settings={settings} onUpdate={updateSection} />}
              {activeTab === 'api-keys' && <ApiKeysTab settings={settings} onReload={loadSettings} />}
              {activeTab === 'database' && <DatabaseTab settings={settings} />}
              {activeTab === 'project' && <ProjectTab settings={settings} onUpdate={updateSection} />}
              {activeTab === 'personalization' && <PersonalizationTab settings={settings} onUpdate={updateSection} />}
              {activeTab === 'about' && <AboutTab />}
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

function TabButton({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '8px 16px', border: 'none',
        background: active ? 'var(--accent-color)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: active ? 500 : 400,
        cursor: 'pointer', textAlign: 'left',
        borderRadius: 0,
      }}
    >
      {tab.icon}
      {t(`settings.tabs.${tab.labelKey}`)}
    </button>
  );
}
