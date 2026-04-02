/**
 * SettingsView — full application configuration panel.
 *
 * Left tab navigation + right content area.
 * Tabs ordered by usage frequency:
 *   AI Models | Retrieval & Context | Acquisition | Analysis & Language
 *   | API Keys | Database & Storage | Cost Monitor | Project Info | About
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Sun, Moon, Monitor, Key, Cpu, FolderOpen, Keyboard, Info,
  Database, Search, Download, FileText, Languages, DollarSign,
  ChevronRight, Check, X, AlertTriangle, RefreshCw, ExternalLink,
  GripVertical, Loader2, Eye, EyeOff, Zap, Shield, BarChart3, Palette,
  Globe, BookOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../core/context/ThemeContext';
import { getAPI } from '../../core/ipc/bridge';
import { SUPPORTED_LOCALES, changeLocale } from '../../i18n';
import type { SupportedLocale } from '../../i18n';
import type { SettingsData, DbStatsInfo, SystemInfo } from '../../../shared-types/models';
import { setAuthorDisplayThreshold } from '../../core/hooks/useAuthorDisplay';
import {
  EMBEDDING_MODEL_REGISTRY,
  defaultModelForProvider,
  type EmbeddingProvider,
} from '../../../core/config/config-schema';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

type TabId =
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

interface TabDef {
  id: TabId;
  labelKey: keyof typeof import('../../i18n/locales/en').en.settings.tabs;
  icon: React.ReactNode;
}

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

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'siliconflow'] as const;
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  siliconflow: 'SiliconFlow',
};

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250901', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  siliconflow: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen3-235B-A22B', 'Qwen/Qwen2.5-72B-Instruct'],
};

const WORKFLOW_KEYS = ['discovery', 'analysis', 'synthesize', 'article', 'agent'] as const;

// ═══════════════════════════════════════════════════════════════════
// Root Component
// ═══════════════════════════════════════════════════════════════════

export function SettingsView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('ai-models');
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const loadSettings = useCallback(async () => {
    try {
      const data = await getAPI().settings.getAll();
      setSettings(data);
    } catch { /* stub mode */ }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Debounced save: accumulate patches per section, flush after 600ms idle
  const pendingRef = useRef<Record<string, Record<string, unknown>>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = useCallback(async () => {
    const batched = pendingRef.current;
    pendingRef.current = {};
    const sections = Object.entries(batched);
    if (sections.length === 0) return;
    setSaving(true);
    try {
      for (const [section, patch] of sections) {
        await getAPI().settings.updateSection(section, patch);
      }
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(t('settings.saveFailed', { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  }, [t]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const updateSection = useCallback((section: string, patch: Record<string, unknown>) => {
    // Optimistic UI update — immediate
    setSettings((prev) => prev ? { ...prev, [section]: { ...(prev as any)[section], ...patch } } : prev);
    // Accumulate patch
    pendingRef.current[section] = { ...pendingRef.current[section], ...patch };
    // Reset debounce timer
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { flushSave(); }, 600);
  }, [flushSave]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Left Tab Rail ── */}
      <nav style={{
        width: 200,
        minWidth: 200,
        borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface-lowest, var(--bg-base))',
        padding: '16px 0',
        overflowY: 'auto',
      }}>
        <div style={{ padding: '0 16px 12px', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('settings.title')}
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

      {/* ── Right Content Area ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '24px 32px', maxWidth: 760 }}>
          {!settings ? (
            <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ marginTop: 8 }}>{t('settings.loading')}</p>
            </div>
          ) : (
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

      {/* spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab Button
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Shared Sub-components
// ═══════════════════════════════════════════════════════════════════

function Section({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: 'var(--text-primary)' }}>
        {icon}
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: 0 }}>{title}</h2>
      </div>
      {description && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px 23px' }}>{description}</p>
      )}
      <div style={{
        background: 'var(--bg-surface-low, var(--bg-surface))',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md, 6px)',
        padding: '12px 16px',
      }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, hint, children, noBorder }: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
  noBorder?: boolean | undefined;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0',
      borderBottom: noBorder ? 'none' : '1px solid var(--border-subtle)',
    }}>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0, marginLeft: 16 }}>
        {children}
      </div>
    </div>
  );
}

function Select({ value, options, onChange, width }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  width?: number | undefined;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: width ?? 200, padding: '4px 8px', fontSize: 13,
        background: 'var(--bg-base)', color: 'var(--text-primary)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)',
        outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function NumberInput({ value, min, max, step, onChange, width }: {
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  onChange: (v: number) => void;
  width?: number | undefined;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      style={{
        width: width ?? 100, padding: '4px 8px', fontSize: 13,
        background: 'var(--bg-base)', color: 'var(--text-primary)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)',
        outline: 'none',
      }}
    />
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none',
        background: checked ? 'var(--accent-color)' : 'var(--bg-surface-high, #555)',
        cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: 7,
        background: '#fff',
        position: 'absolute', top: 3,
        left: checked ? 19 : 3,
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

function SegmentedControl({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--bg-surface-high, var(--bg-surface))', borderRadius: 'var(--radius-sm)', padding: 2 }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: '4px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
            borderRadius: 'var(--radius-sm, 4px)',
            background: value === o.value ? 'var(--accent-color)' : 'transparent',
            color: value === o.value ? '#fff' : 'var(--text-secondary)',
            fontWeight: value === o.value ? 500 : 400,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm, 4px)',
      background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: ok ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
    }}>
      {label}
    </span>
  );
}

function SliderRow({ label, hint, value, min, max, step, onChange, suffix, semanticLeft, semanticRight }: {
  label: string;
  hint?: string | undefined;
  value: number;
  min: number;
  max: number;
  step?: number | undefined;
  onChange: (v: number) => void;
  suffix?: string | undefined;
  semanticLeft?: string | undefined;
  semanticRight?: string | undefined;
}) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
          {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {value}{suffix ?? ''}
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent-color)' }}
        />
        {(semanticLeft || semanticRight) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
            <span>{semanticLeft}</span>
            <span>{semanticRight}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: AI Models
// ═══════════════════════════════════════════════════════════════════

function AiModelsTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: (s: string, p: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const { llm, rag, ai } = settings;

  const handleDefaultProviderChange = (provider: string) => {
    const models = MODELS_BY_PROVIDER[provider];
    onUpdate('llm', {
      defaultProvider: provider,
      defaultModel: models && models.length > 0 ? models[0] : llm.defaultModel,
    });
  };

  return (
    <>
      <Section icon={<Cpu size={16} />} title={t('settings.aiModels.defaultModel')} description={t('settings.aiModels.defaultModelDesc')}>
        <Row label={t('settings.aiModels.provider')}>
          <Select
            value={llm.defaultProvider}
            options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] ?? p }))}
            onChange={handleDefaultProviderChange}
          />
        </Row>
        <Row label={t('settings.aiModels.model')} noBorder>
          {(MODELS_BY_PROVIDER[llm.defaultProvider]?.length ?? 0) > 0 ? (
            <Select
              value={llm.defaultModel}
              options={(MODELS_BY_PROVIDER[llm.defaultProvider] ?? []).map((m) => ({ value: m, label: m }))}
              onChange={(v) => onUpdate('llm', { defaultModel: v })}
            />
          ) : (
            <input
              type="text"
              value={llm.defaultModel}
              onChange={(e) => onUpdate('llm', { defaultModel: e.target.value })}
              placeholder={t('settings.aiModels.modelPlaceholder')}
              style={{
                width: 200, padding: '4px 8px', fontSize: 13,
                background: 'var(--bg-base)', color: 'var(--text-primary)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                outline: 'none',
              }}
            />
          )}
        </Row>
      </Section>

      <Section icon={<Zap size={16} />} title={t('settings.aiModels.workflowRouting')} description={t('settings.aiModels.workflowRoutingDesc')}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'left' }}>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('settings.aiModels.colWorkflow')}</th>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('settings.aiModels.colDefault')}</th>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('settings.aiModels.colProvider')}</th>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('settings.aiModels.colModel')}</th>
              </tr>
            </thead>
            <tbody>
              {WORKFLOW_KEYS.map((wf) => {
                const override = llm.workflowOverrides[wf];
                const isDefault = !override;
                return (
                  <WorkflowRow
                    key={wf}
                    workflow={wf}
                    label={t(`settings.workflows.${wf}`)}
                    hint={t(`settings.workflowHints.${wf}`)}
                    isDefault={isDefault}
                    provider={override?.provider ?? llm.defaultProvider}
                    model={override?.model ?? llm.defaultModel}
                    onToggleDefault={(useDefault) => {
                      const overrides = { ...llm.workflowOverrides };
                      if (useDefault) {
                        delete overrides[wf];
                      } else {
                        overrides[wf] = { provider: llm.defaultProvider, model: llm.defaultModel };
                      }
                      onUpdate('llm', { workflowOverrides: overrides });
                    }}
                    onChangeProvider={(p) => {
                      const models = MODELS_BY_PROVIDER[p];
                      const overrides = { ...llm.workflowOverrides };
                      overrides[wf] = {
                        ...overrides[wf],
                        provider: p,
                        model: models && models.length > 0 ? models[0]! : '',
                      };
                      onUpdate('llm', { workflowOverrides: overrides });
                    }}
                    onChangeModel={(m) => {
                      const overrides = { ...llm.workflowOverrides };
                      overrides[wf] = { ...overrides[wf], provider: overrides[wf]?.provider ?? llm.defaultProvider, model: m };
                      onUpdate('llm', { workflowOverrides: overrides });
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, padding: '4px 0' }}>
          {t('settings.aiModels.routingNote')}
        </div>
      </Section>

      <Section icon={<Zap size={16} />} title={t('settings.aiModels.proactiveSuggestions')} description={t('settings.aiModels.proactiveSuggestionsDesc')}>
        <Row label={t('settings.aiModels.enabled')} noBorder>
          <Toggle
            checked={ai?.proactiveSuggestions ?? false}
            onChange={(v) => onUpdate('ai', { proactiveSuggestions: v })}
          />
        </Row>
      </Section>

      <Section icon={<Shield size={16} />} title={t('settings.aiModels.correctiveRag')} description={t('settings.aiModels.correctiveRagDesc')}>
        <Row label={t('settings.aiModels.enabled')}>
          <Toggle
            checked={rag.correctiveRagEnabled}
            onChange={(v) => onUpdate('rag', { correctiveRagEnabled: v })}
          />
        </Row>
        <Row label={t('settings.aiModels.verificationModel')}>
          <input
            type="text"
            value={rag.correctiveRagModel}
            onChange={(e) => onUpdate('rag', { correctiveRagModel: e.target.value })}
            style={{
              width: 200, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
              opacity: rag.correctiveRagEnabled ? 1 : 0.5,
            }}
            disabled={!rag.correctiveRagEnabled}
          />
        </Row>
        <Row label={t('settings.aiModels.maxRetries')} noBorder>
          <NumberInput
            value={rag.correctiveRagMaxRetries}
            min={0}
            max={5}
            onChange={(v) => onUpdate('rag', { correctiveRagMaxRetries: v })}
            width={80}
          />
        </Row>
      </Section>
    </>
  );
}

function WorkflowRow({ workflow, label, hint, isDefault, provider, model, onToggleDefault, onChangeProvider, onChangeModel }: {
  workflow: string;
  label: string;
  hint?: string | undefined;
  isDefault: boolean;
  provider: string;
  model: string;
  onToggleDefault: (useDefault: boolean) => void;
  onChangeProvider: (p: string) => void;
  onChangeModel: (m: string) => void;
}) {
  const models = MODELS_BY_PROVIDER[provider] ?? [];
  return (
    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <td style={{ padding: '6px 8px' }}>
        <div style={{ color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</div>}
      </td>
      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
        <input type="checkbox" checked={isDefault} onChange={(e) => onToggleDefault(e.target.checked)} />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <select
          value={provider}
          disabled={isDefault}
          onChange={(e) => onChangeProvider(e.target.value)}
          style={{
            padding: '3px 6px', fontSize: 12, width: 120,
            background: 'var(--bg-base)', color: 'var(--text-primary)',
            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
            opacity: isDefault ? 0.4 : 1,
          }}
        >
          {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>)}
        </select>
      </td>
      <td style={{ padding: '6px 8px' }}>
        {models.length > 0 ? (
          <select
            value={model}
            disabled={isDefault}
            onChange={(e) => onChangeModel(e.target.value)}
            style={{
              padding: '3px 6px', fontSize: 12, width: 200,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              opacity: isDefault ? 0.4 : 1,
            }}
          >
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input
            type="text"
            value={model}
            disabled={isDefault}
            onChange={(e) => onChangeModel(e.target.value)}
            placeholder="model name"
            style={{
              padding: '3px 6px', fontSize: 12, width: 200,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              opacity: isDefault ? 0.4 : 1,
              outline: 'none',
            }}
          />
        )}
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: Retrieval & Context
// ═══════════════════════════════════════════════════════════════════

function RetrievalTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: (s: string, p: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const { rag, contextBudget, discovery } = settings;

  return (
    <>
      {/* Embedding provider + model (linked, with confirmation) */}
      <Section icon={<Database size={16} />} title={t('settings.retrieval.embeddingModel')} description={t('settings.retrieval.embeddingModelDesc')}>
        <Row label={t('settings.aiModels.provider')}>
          <SegmentedControl
            value={rag.embeddingProvider ?? 'openai'}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'siliconflow', label: 'SiliconFlow' },
            ]}
            onChange={(v) => {
              const provider = v as EmbeddingProvider;
              if (provider === (rag.embeddingProvider ?? 'openai')) return;
              const def = defaultModelForProvider(provider);
              if (!window.confirm(t('settings.retrieval.embeddingChangeConfirm'))) return;
              onUpdate('rag', {
                embeddingProvider: provider,
                embeddingModel: def.model,
                embeddingDimension: def.dimension,
              });
            }}
          />
        </Row>
        <Row label={t('settings.aiModels.model')} hint={`${rag.embeddingDimension}d`}>
          <Select
            value={rag.embeddingModel}
            options={
              (EMBEDDING_MODEL_REGISTRY[(rag.embeddingProvider ?? 'openai') as EmbeddingProvider] ?? [])
                .map((m) => ({ value: m.model, label: m.label }))
            }
            onChange={(v) => {
              if (v === rag.embeddingModel) return;
              if (!window.confirm(t('settings.retrieval.embeddingChangeConfirm'))) return;
              const models = EMBEDDING_MODEL_REGISTRY[(rag.embeddingProvider ?? 'openai') as EmbeddingProvider] ?? [];
              const picked = models.find((m) => m.model === v);
              onUpdate('rag', {
                embeddingModel: v,
                ...(picked ? { embeddingDimension: picked.dimension } : {}),
              });
            }}
          />
        </Row>
        <div style={{ fontSize: 11, color: 'var(--warning, #f59e0b)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={12} />
          {t('settings.retrieval.embeddingChangeNote')}
        </div>
      </Section>

      <Section icon={<Search size={16} />} title={t('settings.retrieval.retrievalParams')}>
        <SliderRow
          label={t('settings.retrieval.defaultTopK')}
          hint={t('settings.retrieval.defaultTopKHint')}
          value={rag.defaultTopK}
          min={1}
          max={100}
          onChange={(v) => onUpdate('rag', { defaultTopK: v })}
        />
        <SliderRow
          label={t('settings.retrieval.knnExpandFactor')}
          hint={t('settings.retrieval.knnExpandFactorHint')}
          value={rag.expandFactor}
          min={1}
          max={20}
          onChange={(v) => onUpdate('rag', { expandFactor: v })}
        />
        <SliderRow
          label={t('settings.retrieval.tentativeExpandMultiplier')}
          value={rag.tentativeExpandFactorMultiplier}
          min={1.0}
          max={5.0}
          step={0.1}
          onChange={(v) => onUpdate('rag', { tentativeExpandFactorMultiplier: v })}
        />
        <SliderRow
          label={t('settings.retrieval.tentativeTopKMultiplier')}
          value={rag.tentativeTopkMultiplier}
          min={1.0}
          max={5.0}
          step={0.1}
          onChange={(v) => onUpdate('rag', { tentativeTopkMultiplier: v })}
        />
      </Section>

      <Section icon={<BarChart3 size={16} />} title={t('settings.retrieval.rerankerBackend')}>
        <Row label={t('settings.retrieval.backend')} noBorder>
          <SegmentedControl
            value={rag.rerankerBackend}
            options={[
              { value: 'cohere', label: 'Cohere API' },
              { value: 'jina', label: 'Jina API' },
              { value: 'siliconflow', label: 'SiliconFlow' },
            ]}
            onChange={(v) => onUpdate('rag', { rerankerBackend: v })}
          />
        </Row>
      </Section>

      <Section icon={<DollarSign size={16} />} title={t('settings.retrieval.contextBudget')} description={t('settings.retrieval.contextBudgetDesc')}>
        <Row label={t('settings.retrieval.costPreference')}>
          <SegmentedControl
            value={contextBudget.costPreference}
            options={[
              { value: 'aggressive', label: t('settings.retrieval.aggressive') },
              { value: 'balanced', label: t('settings.retrieval.balanced') },
              { value: 'conservative', label: t('settings.retrieval.conservative') },
            ]}
            onChange={(v) => onUpdate('contextBudget', { costPreference: v })}
          />
        </Row>
        <Row label={t('settings.retrieval.focusedModeLimit')} hint={t('settings.retrieval.focusedModeLimitHint')}>
          <NumberInput
            value={contextBudget.focusedMaxTokens}
            min={10000}
            max={100000}
            step={1000}
            onChange={(v) => onUpdate('contextBudget', { focusedMaxTokens: v })}
          />
        </Row>
        <Row label={t('settings.retrieval.broadModeLimit')} hint={t('settings.retrieval.broadModeLimitHint')}>
          <NumberInput
            value={contextBudget.broadMaxTokens}
            min={30000}
            max={200000}
            step={1000}
            onChange={(v) => onUpdate('contextBudget', { broadMaxTokens: v })}
          />
        </Row>
        <SliderRow
          label={t('settings.retrieval.skipRerankerThreshold')}
          hint={t('settings.retrieval.skipRerankerThresholdHint')}
          value={contextBudget.skipRerankerThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onUpdate('contextBudget', { skipRerankerThreshold: v })}
        />
      </Section>

      <Section icon={<Search size={16} />} title={t('settings.retrieval.litDiscovery')}>
        <SliderRow
          label={t('settings.retrieval.citationDepth')}
          hint={t('settings.retrieval.citationDepthHint')}
          value={discovery.traversalDepth}
          min={1}
          max={4}
          onChange={(v) => onUpdate('discovery', { traversalDepth: v })}
          semanticLeft={t('settings.retrieval.shallow')}
          semanticRight={t('settings.retrieval.deep')}
        />
        <Row label={t('settings.retrieval.maxResultsPerQuery')}>
          <NumberInput
            value={discovery.maxResultsPerQuery}
            min={10}
            max={500}
            onChange={(v) => onUpdate('discovery', { maxResultsPerQuery: v })}
          />
        </Row>
        <Row label={t('settings.retrieval.concurrency')} noBorder>
          <NumberInput
            value={discovery.concurrency}
            min={1}
            max={20}
            onChange={(v) => onUpdate('discovery', { concurrency: v })}
            width={80}
          />
        </Row>
      </Section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: Acquisition
// ═══════════════════════════════════════════════════════════════════

function AcquisitionTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: (s: string, p: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const { acquire } = settings;
  const defaultOrder = ['unpaywall', 'arxiv', 'pmc', 'china-institutional', 'institutional', 'scihub'];

  // Derive display order: enabledSources first (in their saved order), then disabled ones
  const sourceOrder = useMemo(() => {
    const enabled = acquire.enabledSources.filter((s) => defaultOrder.includes(s));
    const disabled = defaultOrder.filter((s) => !enabled.includes(s));
    return [...enabled, ...disabled];
  }, [acquire.enabledSources]);

  const toggleSource = (source: string) => {
    const current = acquire.enabledSources;
    const next = current.includes(source)
      ? current.filter((s) => s !== source)
      : [...current, source];
    onUpdate('acquire', { enabledSources: next });
  };

  // ─── Pointer-driven drag reordering with smooth animation ───
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [dragState, setDragState] = useState<{
    active: boolean;
    idx: number;       // original index of dragged item
    currentIdx: number; // where it would drop
    offsetY: number;   // pointer offset from item top
    startY: number;    // pointer Y at drag start
    pointerY: number;  // current pointer Y
  } | null>(null);

  // Measure row heights on drag start
  const rowRectsRef = useRef<DOMRect[]>([]);

  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    // Only start drag from the grip handle (identified by data-grip)
    const target = e.target as HTMLElement;
    if (!target.closest('[data-grip]')) return;

    e.preventDefault();
    const el = itemRefs.current[idx];
    if (!el) return;

    // Capture pointer
    el.setPointerCapture(e.pointerId);

    // Snapshot all row positions
    rowRectsRef.current = itemRefs.current.map((r) => r!.getBoundingClientRect());

    const rect = el.getBoundingClientRect();
    setDragState({
      active: true,
      idx,
      currentIdx: idx,
      offsetY: e.clientY - rect.top,
      startY: e.clientY,
      pointerY: e.clientY,
    });
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState?.active) return;
    e.preventDefault();

    const rects = rowRectsRef.current;
    const pointerY = e.clientY;

    // Determine which slot the pointer is over
    let newIdx = dragState.idx;
    for (let i = 0; i < rects.length; i++) {
      const mid = rects[i]!.top + rects[i]!.height / 2;
      if (pointerY < mid) { newIdx = i; break; }
      newIdx = i;
    }

    setDragState((prev) => prev ? { ...prev, pointerY, currentIdx: newIdx } : prev);
  }, [dragState?.active, dragState?.idx]);

  const handlePointerUp = useCallback(() => {
    if (!dragState?.active) return;
    const { idx, currentIdx } = dragState;

    if (idx !== currentIdx) {
      const reordered = [...sourceOrder];
      const [moved] = reordered.splice(idx, 1);
      reordered.splice(currentIdx, 0, moved!);

      const enabledSet = new Set(acquire.enabledSources);
      const newEnabled = reordered.filter((s) => enabledSet.has(s));
      onUpdate('acquire', { enabledSources: newEnabled });
    }
    setDragState(null);
  }, [dragState, sourceOrder, acquire.enabledSources, onUpdate]);

  // Compute per-item transform for the swap animation
  const getItemStyle = (idx: number): React.CSSProperties => {
    if (!dragState?.active) return {};
    const { idx: dragIdx, currentIdx, pointerY, startY } = dragState;

    if (idx === dragIdx) {
      // Dragged item: follows the pointer
      return {
        transform: `translateY(${pointerY - startY}px)`,
        zIndex: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        transition: 'box-shadow 0.2s',
        position: 'relative',
      };
    }

    // Other items: shift up or down to make room
    const rowH = rowRectsRef.current[dragIdx]?.height ?? 40;
    if (dragIdx < currentIdx && idx > dragIdx && idx <= currentIdx) {
      return { transform: `translateY(${-rowH}px)`, transition: 'transform 0.2s ease' };
    }
    if (dragIdx > currentIdx && idx < dragIdx && idx >= currentIdx) {
      return { transform: `translateY(${rowH}px)`, transition: 'transform 0.2s ease' };
    }
    return { transform: 'translateY(0)', transition: 'transform 0.2s ease' };
  };

  // Source display names (fallback for missing i18n keys)
  const sourceLabels: Record<string, string> = {
    unpaywall: 'Unpaywall (OA)',
    arxiv: 'arXiv',
    pmc: 'PubMed Central',
    institutional: 'Institutional Proxy (EZProxy)',
    'china-institutional': 'China Institutional (CARSI)',
    scihub: 'Sci-Hub',
  };

  return (
    <>
      <Section icon={<Download size={16} />} title={t('settings.acquisition.sourceCascade')} description={t('settings.acquisition.sourceCascadeDesc')}>
        <div ref={listRef} style={{ userSelect: dragState ? 'none' : undefined }}>
          {sourceOrder.map((src, idx) => {
            const enabled = acquire.enabledSources.includes(src);
            const isScihub = src === 'scihub';
            const isChinaInst = src === 'china-institutional';
            const isDragging = dragState?.active && dragState.idx === idx;
            return (
              <div
                key={src}
                ref={(el) => { itemRefs.current[idx] = el; }}
                onPointerDown={(e) => handlePointerDown(e, idx)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  opacity: enabled ? 1 : 0.5,
                  background: isDragging ? 'var(--bg-subtle)' : undefined,
                  borderRadius: isDragging ? 'var(--radius-sm)' : undefined,
                  ...getItemStyle(idx),
                }}
              >
                <div data-grip style={{ display: 'flex', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}>
                  <GripVertical size={14} style={{ color: 'var(--text-muted)' }} />
                </div>
                <Toggle checked={enabled} onChange={() => toggleSource(src)} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {sourceLabels[src] ?? src}
                  </span>
                  {isScihub && (
                    <div style={{ fontSize: 10, color: 'var(--warning, #f59e0b)', marginTop: 2 }}>
                      {t('settings.acquisition.scihubWarning')}
                    </div>
                  )}
                  {isChinaInst && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      CARSI / Shibboleth federation — requires login below
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── China Institutional Access ── */}
      <ChinaInstitutionalSection acquire={acquire} onUpdate={onUpdate} />

      <Section icon={<ExternalLink size={16} />} title={t('settings.acquisition.institutionalProxy')}>
        <Row label={t('settings.acquisition.proxyUrl')} hint={t('settings.acquisition.proxyUrlHint')} noBorder>
          <input
            type="text"
            value={acquire.institutionalProxyUrl ?? ''}
            placeholder={t('settings.acquisition.proxyUrlPlaceholder')}
            onChange={(e) => onUpdate('acquire', { institutionalProxyUrl: e.target.value || null })}
            style={{
              width: 260, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          />
        </Row>
      </Section>

      {/* ── Network Proxy ── */}
      <Section icon={<Globe size={16} />} title={t('settings.acquisition.networkProxy')} description={t('settings.acquisition.networkProxyDesc')}>
        <Row label={t('settings.acquisition.networkProxyEnabled')}>
          <Toggle checked={acquire.proxyEnabled ?? false} onChange={(v) => onUpdate('acquire', { proxyEnabled: v })} />
        </Row>
        <Row label={t('settings.acquisition.networkProxyUrl')} hint={t('settings.acquisition.networkProxyUrlHint')}>
          <input
            type="text"
            value={acquire.proxyUrl ?? 'http://127.0.0.1:7890'}
            onChange={(e) => onUpdate('acquire', { proxyUrl: e.target.value || 'http://127.0.0.1:7890' })}
            disabled={!acquire.proxyEnabled}
            style={{
              width: 260, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
              opacity: acquire.proxyEnabled ? 1 : 0.5,
            }}
          />
        </Row>
        <Row label={t('settings.acquisition.networkProxyMode')} hint={t('settings.acquisition.networkProxyModeHint')} noBorder>
          <SegmentedControl
            value={acquire.proxyMode ?? 'blocked-only'}
            options={[
              { value: 'blocked-only', label: t('settings.acquisition.networkProxyModeBlocked') },
              { value: 'all', label: t('settings.acquisition.networkProxyModeAll') },
            ]}
            onChange={(v) => onUpdate('acquire', { proxyMode: v })}
          />
        </Row>
      </Section>

      {/* ── Chinese Academic Databases ── */}
      <Section icon={<BookOpen size={16} />} title={t('settings.acquisition.chineseDb')} description={t('settings.acquisition.chineseDbDesc')}>
        <Row label={t('settings.acquisition.enableCnki')} hint={t('settings.acquisition.enableCnkiHint')}>
          <Toggle checked={acquire.enableCnki ?? false} onChange={(v) => onUpdate('acquire', { enableCnki: v })} />
        </Row>
        <Row label={t('settings.acquisition.enableWanfang')} hint={t('settings.acquisition.enableWanfangHint')} noBorder>
          <Toggle checked={acquire.enableWanfang ?? false} onChange={(v) => onUpdate('acquire', { enableWanfang: v })} />
        </Row>
      </Section>

      {/* ── Publisher Library ── */}
      <PublisherLibrarySection />

      <Section icon={<RefreshCw size={16} />} title={t('settings.acquisition.downloadSettings')}>
        <SliderRow
          label={t('settings.acquisition.downloadTimeout')}
          value={acquire.perSourceTimeoutMs / 1000}
          min={10}
          max={120}
          suffix="s"
          onChange={(v) => onUpdate('acquire', { perSourceTimeoutMs: v * 1000 })}
        />
        <Row label={t('settings.acquisition.maxRedirects')} noBorder>
          <NumberInput
            value={acquire.maxRedirects}
            min={1}
            max={10}
            onChange={(v) => onUpdate('acquire', { maxRedirects: v })}
            width={80}
          />
        </Row>
      </Section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Publisher Library Section
// ═══════════════════════════════════════════════════════════════════

const PUBLISHER_REGISTRY: Array<{ name: string; doiPrefixes: string[]; domains: string[] }> = [
  { name: 'IEEE', doiPrefixes: ['10.1109'], domains: ['ieeexplore.ieee.org'] },
  { name: 'Elsevier / ScienceDirect', doiPrefixes: ['10.1016'], domains: ['sciencedirect.com', 'cell.com'] },
  { name: 'Springer', doiPrefixes: ['10.1007'], domains: ['link.springer.com'] },
  { name: 'Nature', doiPrefixes: ['10.1038'], domains: ['nature.com'] },
  { name: 'Wiley', doiPrefixes: ['10.1002', '10.1111'], domains: ['onlinelibrary.wiley.com'] },
  { name: 'Taylor & Francis', doiPrefixes: ['10.1080', '10.1081'], domains: ['tandfonline.com'] },
  { name: 'ACS', doiPrefixes: ['10.1021'], domains: ['pubs.acs.org'] },
  { name: 'RSC', doiPrefixes: ['10.1039'], domains: ['pubs.rsc.org'] },
  { name: 'SAGE', doiPrefixes: ['10.1177'], domains: ['journals.sagepub.com'] },
  { name: 'Cambridge University Press', doiPrefixes: ['10.1017'], domains: ['cambridge.org'] },
  { name: 'Oxford University Press', doiPrefixes: ['10.1093'], domains: ['academic.oup.com'] },
  { name: 'MDPI', doiPrefixes: ['10.3390'], domains: ['mdpi.com'] },
  { name: 'ACM', doiPrefixes: ['10.1145'], domains: ['dl.acm.org'] },
  { name: 'APS (Physical Review)', doiPrefixes: ['10.1103'], domains: ['journals.aps.org'] },
  { name: 'AIP', doiPrefixes: ['10.1063'], domains: ['pubs.aip.org'] },
  { name: 'IOP', doiPrefixes: ['10.1088'], domains: ['iopscience.iop.org'] },
  { name: 'De Gruyter', doiPrefixes: ['10.1515'], domains: ['degruyter.com'] },
  { name: 'PNAS', doiPrefixes: ['10.1073'], domains: ['pnas.org'] },
  { name: 'Science (AAAS)', doiPrefixes: ['10.1126'], domains: ['science.org'] },
  { name: 'U. of Chicago Press', doiPrefixes: ['10.1086'], domains: ['journals.uchicago.edu'] },
  { name: 'Wolters Kluwer / LWW', doiPrefixes: ['10.1097'], domains: ['journals.lww.com'] },
  { name: 'Annual Reviews', doiPrefixes: ['10.1146'], domains: ['annualreviews.org'] },
  { name: 'Thieme', doiPrefixes: ['10.1055'], domains: ['thieme-connect.com'] },
  { name: 'Karger', doiPrefixes: ['10.1159'], domains: ['karger.com'] },
  { name: 'BMJ', doiPrefixes: ['10.1136'], domains: ['bmj.com'] },
  { name: 'Mary Ann Liebert', doiPrefixes: ['10.1089'], domains: ['liebertpub.com'] },
  { name: 'Emerald', doiPrefixes: ['10.1108'], domains: ['emerald.com'] },
  { name: 'JSTOR', doiPrefixes: ['10.2307'], domains: ['jstor.org'] },
  { name: 'Routledge', doiPrefixes: ['10.4324'], domains: ['taylorfrancis.com'] },
  { name: 'World Scientific', doiPrefixes: ['10.1142'], domains: ['worldscientific.com'] },
  { name: 'ASCE', doiPrefixes: ['10.1061'], domains: ['ascelibrary.org'] },
  { name: 'ASME', doiPrefixes: ['10.1115'], domains: ['asmedigitalcollection.asme.org'] },
  { name: 'Sciendo', doiPrefixes: ['10.2478'], domains: ['sciendo.com'] },
  { name: 'SPIE', doiPrefixes: ['10.1117'], domains: ['spiedigitallibrary.org'] },
];

function PublisherLibrarySection() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <Section
      icon={<BookOpen size={16} />}
      title={t('settings.acquisition.publisherLibrary')}
      description={t('settings.acquisition.publisherLibraryDesc')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded ? 10 : 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('settings.acquisition.publisherCount', { count: PUBLISHER_REGISTRY.length })}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: '3px 10px', fontSize: 12, border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            background: 'transparent', color: 'var(--text-secondary)',
          }}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {PUBLISHER_REGISTRY.map((pub) => (
            <div
              key={pub.name}
              style={{
                padding: '6px 10px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {pub.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {pub.doiPrefixes.join(', ')} — {pub.domains[0]}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// China Institutional Access Section
// ═══════════════════════════════════════════════════════════════════

interface ChinaInstProps {
  acquire: SettingsData['acquire'];
  onUpdate: (section: string, patch: Record<string, unknown>) => void;
}

function ChinaInstitutionalSection({ acquire, onUpdate }: ChinaInstProps) {
  const [institutions, setInstitutions] = useState<Array<{ id: string; name: string; nameEn: string; publishers: string[] }>>([]);
  const [sessionStatus, setSessionStatus] = useState<{
    loggedIn: boolean;
    institutionId: string | null;
    institutionName: string | null;
    lastLogin: string | null;
    activeDomains: string[];
  } | null>(null);
  const [loginLoading, setLoginLoading] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<Record<string, 'loading' | 'valid' | 'expired' | null>>({});

  const api = getAPI();

  // Load institutions and session status
  useEffect(() => {
    api.acquire.getInstitutions().then((list) => list && setInstitutions(list)).catch(() => {});
    api.acquire.sessionStatus().then((s) => s && setSessionStatus(s)).catch(() => {});
  }, []);

  const selectedInst = institutions.find((i) => i.id === acquire.chinaInstitutionId);

  const PUBLISHER_LABELS: Record<string, string> = {
    ieee: 'IEEE Xplore',
    elsevier: 'Elsevier / ScienceDirect',
    springer: 'Springer / Nature',
    wiley: 'Wiley',
    acs: 'ACS Publications',
    rsc: 'RSC',
    cnki: 'CNKI (知网)',
    wanfang: 'Wanfang (万方)',
  };

  const PUBLISHER_DOMAINS: Record<string, string[]> = {
    ieee: ['ieeexplore.ieee.org', 'ieee.org'],
    elsevier: ['sciencedirect.com', 'elsevier.com'],
    springer: ['link.springer.com', 'springer.com', 'nature.com'],
    wiley: ['onlinelibrary.wiley.com', 'wiley.com'],
    acs: ['pubs.acs.org'],
    rsc: ['pubs.rsc.org'],
    cnki: ['cnki.net', 'cnki.com.cn', 'kns.cnki.net', 'fsso.cnki.net'],
    wanfang: ['wanfangdata.com.cn', 'd.wanfangdata.com.cn'],
  };

  const [loginResult, setLoginResult] = useState<{ publisher: string; success: boolean; cookieCount: number } | null>(null);

  const handleLogin = async (publisher: string) => {
    if (!acquire.chinaInstitutionId) return;
    setLoginLoading(publisher);
    setLoginResult(null);
    try {
      const result = await api.acquire.institutionalLogin(acquire.chinaInstitutionId, publisher);
      if (result) {
        setLoginResult({ publisher, success: result.success, cookieCount: result.cookieCount });
        const label = PUBLISHER_LABELS[publisher] ?? publisher;
        if (result.success) {
          toast.success(`${label} login successful (${result.cookieCount} cookies captured)`);
        } else {
          toast.error(`${label} login failed — no session cookies captured`);
        }
      }
    } catch (err) {
      console.error('Institutional login failed:', err);
      setLoginResult({ publisher, success: false, cookieCount: 0 });
      toast.error(`${PUBLISHER_LABELS[publisher] ?? publisher} login error`);
    } finally {
      try {
        const status = await api.acquire.sessionStatus();
        if (status) setSessionStatus(status);
      } catch { /* ignore */ }
      setLoginLoading(null);
    }
  };

  const handleVerify = async (publisher: string) => {
    setVerifyState((prev) => ({ ...prev, [publisher]: 'loading' }));
    try {
      const result = await api.acquire.verifyCookies(publisher);
      setVerifyState((prev) => ({ ...prev, [publisher]: result.valid ? 'valid' : 'expired' }));
    } catch {
      setVerifyState((prev) => ({ ...prev, [publisher]: 'expired' }));
    }
  };

  const handleClearSession = async () => {
    await api.acquire.clearSession();
    setSessionStatus({ loggedIn: false, institutionId: null, institutionName: null, lastLogin: null, activeDomains: [] });
    setVerifyState({});
  };

  return (
    <Section icon={<Shield size={16} />} title="China Institutional Access (CARSI)" description="Log in with your university account to download papers from academic databases.">
      {/* University selector */}
      <Row label="University" noBorder={!acquire.chinaInstitutionId}>
        <select
          value={acquire.chinaInstitutionId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            onUpdate('acquire', {
              chinaInstitutionId: id,
              enableChinaInstitutional: !!id,
            });
          }}
          style={{
            width: 220, padding: '4px 8px', fontSize: 13,
            background: 'var(--bg-base)', color: 'var(--text-primary)',
            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
          }}
        >
          <option value="">-- Select University --</option>
          {institutions.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} ({inst.nameEn})
            </option>
          ))}
          <option value="__custom">Other (Custom IdP)</option>
        </select>
      </Row>

      {/* Custom IdP input (when "Other" selected) */}
      {acquire.chinaInstitutionId === '__custom' && (
        <Row label="IdP Entity ID" hint="Your university's Shibboleth IdP entityID URL" noBorder>
          <input
            type="text"
            value={acquire.chinaCustomIdpEntityId ?? ''}
            placeholder="https://idp.your-university.edu.cn/idp/shibboleth"
            onChange={(e) => onUpdate('acquire', { chinaCustomIdpEntityId: e.target.value || null })}
            style={{
              width: 340, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
            }}
          />
        </Row>
      )}

      {/* Login buttons for each publisher */}
      {acquire.chinaInstitutionId && acquire.chinaInstitutionId !== '__custom' && selectedInst && (
        <div style={{ padding: '12px 0' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Database Logins
            {sessionStatus?.lastLogin && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Last: {new Date(sessionStatus.lastLogin).toLocaleString()}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedInst.publishers.map((pub) => {
              const isLoading = loginLoading === pub;
              const domains = PUBLISHER_DOMAINS[pub] ?? [];
              const hasSession = sessionStatus?.activeDomains.some((d) =>
                domains.some((pd) => d.includes(pd)),
              );
              return (
                <div
                  key={pub}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>
                    {PUBLISHER_LABELS[pub] ?? pub}
                  </div>
                  {hasSession && verifyState[pub] !== 'expired' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {verifyState[pub] === 'valid' ? (
                        <span style={{ fontSize: 12, color: 'var(--success, #22c55e)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Check size={14} /> Valid
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--success, #22c55e)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Check size={14} /> Logged in
                        </span>
                      )}
                      <button
                        onClick={() => handleVerify(pub)}
                        disabled={verifyState[pub] === 'loading'}
                        style={{
                          padding: '2px 8px', fontSize: 11,
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                          cursor: verifyState[pub] === 'loading' ? 'wait' : 'pointer',
                        }}
                      >
                        {verifyState[pub] === 'loading' ? 'Verifying...' : 'Verify'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {verifyState[pub] === 'expired' && (
                        <span style={{ fontSize: 11, color: 'var(--warning, #f59e0b)' }}>
                          Session expired
                        </span>
                      )}
                      <button
                        onClick={() => { setVerifyState((prev) => ({ ...prev, [pub]: null })); handleLogin(pub); }}
                        disabled={!!loginLoading}
                        style={{
                          padding: '3px 12px', fontSize: 12,
                          background: isLoading ? 'var(--bg-muted)' : 'var(--bg-base)',
                          color: isLoading ? 'var(--text-muted)' : 'var(--text-primary)',
                          border: `1px solid ${verifyState[pub] === 'expired' ? 'var(--warning, #f59e0b)' : 'var(--border-default)'}`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: isLoading ? 'wait' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {isLoading ? <Loader2 size={12} className="spin" /> : <ExternalLink size={12} />}
                        {isLoading ? 'Logging in...' : verifyState[pub] === 'expired' ? 'Re-login' : 'Login'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Clear session button */}
          {sessionStatus?.loggedIn && (
            <button
              onClick={handleClearSession}
              style={{
                marginTop: 10, padding: '4px 12px', fontSize: 12,
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              Clear all login sessions
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: Analysis & Language
// ═══════════════════════════════════════════════════════════════════

function AnalysisTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: (s: string, p: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const { analysis } = settings;

  return (
    <>
      <Section icon={<FileText size={16} />} title={t('settings.analysis.chunkingParams')} description={t('settings.analysis.chunkingParamsDesc')}>
        <SliderRow
          label={t('settings.analysis.maxTokensPerChunk')}
          hint={t('settings.analysis.maxTokensPerChunkHint')}
          value={analysis.maxTokensPerChunk}
          min={128}
          max={2048}
          step={64}
          onChange={(v) => onUpdate('analysis', { maxTokensPerChunk: v })}
          semanticLeft={t('settings.analysis.morePrecise')}
          semanticRight={t('settings.analysis.moreContext')}
        />
        <SliderRow
          label={t('settings.analysis.overlapTokens')}
          value={analysis.overlapTokens}
          min={0}
          max={512}
          step={16}
          onChange={(v) => onUpdate('analysis', { overlapTokens: v })}
        />
      </Section>

      <Section icon={<Cpu size={16} />} title={t('settings.analysis.analysisFeatures')}>
        <Row label={t('settings.analysis.autoConceptMapping')} hint={t('settings.analysis.autoConceptMappingHint')}>
          <Toggle
            checked={analysis.autoSuggestConcepts}
            onChange={(v) => onUpdate('analysis', { autoSuggestConcepts: v })}
          />
        </Row>
        <Row label={t('settings.analysis.ocrEnabled')} hint={t('settings.analysis.ocrEnabledHint')}>
          <Toggle
            checked={analysis.ocrEnabled}
            onChange={(v) => onUpdate('analysis', { ocrEnabled: v })}
          />
        </Row>
        <Row label={t('settings.analysis.vlmChartParsing')} hint={t('settings.analysis.vlmChartParsingHint')} noBorder>
          <Toggle
            checked={analysis.vlmEnabled}
            onChange={(v) => onUpdate('analysis', { vlmEnabled: v })}
          />
        </Row>
      </Section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: Web Search
// ═══════════════════════════════════════════════════════════════════

const WEB_SEARCH_BACKENDS = [
  { value: 'tavily', label: 'Tavily' },
  { value: 'serpapi', label: 'SerpAPI (Google)' },
  { value: 'bing', label: 'Bing Web Search' },
] as const;

function WebSearchTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: (s: string, p: Record<string, unknown>) => void }) {
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
            onChange={(v) => onUpdate('webSearch', { backend: v })}
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

// ═══════════════════════════════════════════════════════════════════
// Tab: API Keys
// ═══════════════════════════════════════════════════════════════════

interface KeyRowState {
  editing: boolean;
  value: string;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
}

function ApiKeysTab({ settings, onReload }: { settings: SettingsData; onReload: () => void }) {
  const { t } = useTranslation();
  const keys: Array<{ name: string; field: keyof SettingsData['apiKeys']; provider: string; label: string; isEmail?: boolean | undefined }> = [
    { name: 'Anthropic (Claude)', field: 'anthropicApiKey', provider: 'anthropic', label: 'Anthropic API Key' },
    { name: 'OpenAI', field: 'openaiApiKey', provider: 'openai', label: 'OpenAI API Key' },
    { name: 'Google Gemini', field: 'geminiApiKey', provider: 'gemini', label: 'Gemini API Key' },
    { name: 'DeepSeek', field: 'deepseekApiKey', provider: 'deepseek', label: 'DeepSeek API Key' },
    { name: 'Cohere (Reranker)', field: 'cohereApiKey', provider: 'cohere', label: 'Cohere API Key' },
    { name: 'Jina (Reranker)', field: 'jinaApiKey', provider: 'jina', label: 'Jina API Key' },
    { name: 'SiliconFlow (LLM/Embed/Rerank)', field: 'siliconflowApiKey', provider: 'siliconflow', label: 'SiliconFlow API Key' },
    { name: 'Semantic Scholar', field: 'semanticScholarApiKey', provider: '', label: 'S2 API Key' },
    { name: 'Unpaywall', field: 'unpaywallEmail', provider: '', label: 'Email', isEmail: true },
    { name: 'Tavily (Web Search)', field: 'webSearchApiKey', provider: 'tavily', label: 'Tavily API Key' },
  ];

  return (
    <Section icon={<Key size={16} />} title={t('settings.apiKeys.title')} description={t('settings.apiKeys.titleDesc')}>
      {keys.map((k, idx) => (
        <ApiKeyRow
          key={k.field}
          name={k.name}
          field={k.field}
          provider={k.provider}
          label={k.label}
          currentValue={settings.apiKeys[k.field]}
          isEmail={k.isEmail}
          noBorder={idx === keys.length - 1}
          onSaved={onReload}
        />
      ))}
    </Section>
  );
}

function ApiKeyRow({ name, field, provider, label, currentValue, isEmail, noBorder, onSaved }: {
  name: string;
  field: string;
  provider: string;
  label: string;
  currentValue: string | null;
  isEmail?: boolean | undefined;
  noBorder?: boolean | undefined;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const configured = !!currentValue;

  const handleSave = async () => {
    try {
      await getAPI().settings.updateApiKey(field, value);
      setEditing(false);
      setValue('');
      onSaved();
    } catch { /* ignore */ }
  };

  const handleTest = async () => {
    if (!provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await getAPI().settings.testApiKey(provider);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{
      padding: '10px 0',
      borderBottom: noBorder ? 'none' : '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{name}</span>
          {isEmail ? (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
              {currentValue ?? t('settings.apiKeys.notSet')}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8, fontFamily: 'monospace' }}>
              {currentValue ?? t('settings.apiKeys.notSet')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusBadge ok={configured} label={configured ? t('settings.apiKeys.configured') : t('settings.apiKeys.notSet')} />
          {provider && configured && (
            <button
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: '2px 8px', fontSize: 11, border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)', background: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              {testing ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : t('settings.apiKeys.test')}
            </button>
          )}
          <button
            onClick={() => { setEditing(!editing); setTimeout(() => inputRef.current?.focus(), 50); }}
            style={{
              padding: '2px 8px', fontSize: 11, border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)', background: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            {editing ? t('settings.apiKeys.cancel') : t('settings.apiKeys.edit')}
          </button>
        </div>
      </div>

      {testResult && (
        <div style={{
          marginTop: 4, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
          color: testResult.ok ? 'var(--success)' : 'var(--danger)',
        }}>
          {testResult.ok ? <Check size={12} /> : <X size={12} />}
          {testResult.message}
        </div>
      )}

      {editing && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            ref={inputRef}
            type={isEmail ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={isEmail ? 'your@email.com' : t('settings.apiKeys.pasteNewKey')}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
            style={{
              flex: 1, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSave}
            style={{
              padding: '4px 12px', fontSize: 12, border: 'none',
              borderRadius: 'var(--radius-sm)', background: 'var(--accent-color)',
              color: '#fff', cursor: 'pointer',
            }}
          >
            {t('settings.apiKeys.save')}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: Database & Storage
// ═══════════════════════════════════════════════════════════════════

function DatabaseTab({ settings }: { settings: SettingsData }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DbStatsInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAPI().settings.getDbStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <Section icon={<Database size={16} />} title={t('settings.database.status')}>
        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : stats ? (
          <>
            <Row label={t('settings.database.dbSize')}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                {formatBytes(stats.dbSizeBytes)}
              </span>
            </Row>
            <Row label={t('settings.database.papers')}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {t('settings.database.papersValue', { total: stats.paperCount, analyzed: stats.analyzedCount })}
              </span>
            </Row>
            <Row label={t('settings.database.concepts')}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{stats.conceptCount}</span>
            </Row>
            <Row label={t('settings.database.mappings')}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{stats.mappingCount}</span>
            </Row>
            <Row label={t('settings.database.chunksVectorIndex')}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{stats.chunkCount}</span>
            </Row>
            <Row label={t('settings.database.embeddingModel')} noBorder>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                {stats.embeddingModel} ({stats.embeddingDimension}d)
              </span>
            </Row>
          </>
        ) : (
          <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 13 }}>{t('settings.database.unableToLoad')}</div>
        )}
      </Section>

      <Section icon={<AlertTriangle size={16} />} title={t('settings.database.embeddingModelChange')} description={t('settings.database.embeddingModelChangeDesc')}>
        <Row label={t('settings.database.currentEmbeddingModel')} noBorder>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            {settings.rag.embeddingModel}
          </span>
        </Row>
        <div style={{ fontSize: 11, color: 'var(--warning, #f59e0b)', padding: '8px 0 4px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={12} />
          {t('settings.database.embeddingChangeWarning')}
        </div>
      </Section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: Project Info
// ═══════════════════════════════════════════════════════════════════

function ProjectTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: (s: string, p: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const { project, workspace } = settings;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);

  const saveName = () => {
    if (name !== project.name) onUpdate('project', { name });
  };

  const saveDescription = () => {
    if (description !== project.description) onUpdate('project', { description });
  };

  return (
    <>
      <Section icon={<FolderOpen size={16} />} title={t('settings.project.basics')}>
        <Row label={t('settings.project.projectName')}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
            maxLength={128}
            style={{
              width: 260, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          />
        </Row>
        <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{t('settings.project.description')}</span>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {t('settings.project.descriptionHint')}
              </div>
            </div>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            maxLength={512}
            rows={3}
            style={{
              width: '100%', marginTop: 8, padding: '6px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>
            {description.length}/512
          </div>
        </div>
        <Row label={t('settings.project.mode')}>
          <SegmentedControl
            value={project.mode}
            options={[
              { value: 'anchored', label: t('settings.project.anchored') },
              { value: 'unanchored', label: t('settings.project.unanchored') },
              { value: 'auto', label: t('settings.project.auto') },
            ]}
            onChange={(v) => onUpdate('project', { mode: v })}
          />
        </Row>
        <Row label={t('settings.project.workspacePath')} noBorder>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workspace.baseDir}
            </span>
            <button
              onClick={() => getAPI().settings.openWorkspaceFolder()}
              style={{
                padding: '2px 8px', fontSize: 11, border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)', background: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <ExternalLink size={10} /> {t('settings.project.open')}
            </button>
          </div>
        </Row>
      </Section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: Personalization
// ═══════════════════════════════════════════════════════════════════

function PersonalizationTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: (s: string, p: Record<string, unknown>) => void }) {
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
      {/* ── Appearance ── */}
      <Section icon={<Sun size={16} />} title={t('settings.personalization.appearance')}>
        <Row label={t('settings.personalization.theme')} noBorder>
          <ThemeSelector value={colorScheme} onChange={setColorScheme} />
        </Row>
      </Section>

      {/* ── Language ── */}
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

      {/* ── Display ── */}
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

// ═══════════════════════════════════════════════════════════════════
// Tab: About
// ═══════════════════════════════════════════════════════════════════

function AboutTab() {
  const { t } = useTranslation();
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    getAPI().settings.getSystemInfo().then(setSysInfo).catch(() => {});
  }, []);

  return (
    <>
      <Section icon={<Info size={16} />} title={t('settings.about.systemInfo')}>
        <Row label={t('settings.about.abyssalVersion')}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {sysInfo?.appVersion ?? '—'}
          </span>
        </Row>
        <Row label={t('settings.about.electron')}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {sysInfo?.electronVersion ?? '—'}
          </span>
        </Row>
        <Row label={t('settings.about.nodejs')}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {sysInfo?.nodeVersion ?? '—'}
          </span>
        </Row>
        <Row label={t('settings.about.chrome')}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {sysInfo?.chromeVersion ?? '—'}
          </span>
        </Row>
      </Section>

      <Section icon={<Keyboard size={16} />} title={t('settings.about.keyboardShortcuts')}>
        <ShortcutRow keys="Ctrl+1–6" description={t('settings.about.switchViews')} />
        <ShortcutRow keys="Ctrl+B" description={t('settings.about.toggleContextPanel')} />
        <ShortcutRow keys="Ctrl+Shift+N" description={t('settings.about.quickMemo')} />
        <ShortcutRow keys="Ctrl+K" description={t('settings.about.globalSearch')} />
        <ShortcutRow keys="Ctrl+," description={t('settings.about.openSettings')} />
        <ShortcutRow keys="Escape" description={t('settings.about.closeOverlays')} noBorder />
      </Section>
    </>
  );
}

function ThemeSelector({ value, onChange }: { value: string; onChange: (v: 'light' | 'dark' | 'system') => void }) {
  const { t } = useTranslation();
  const options: Array<{ value: 'light' | 'dark' | 'system'; icon: React.ReactNode; label: string }> = [
    { value: 'light', icon: <Sun size={14} />, label: t('settings.about.light') },
    { value: 'dark', icon: <Moon size={14} />, label: t('settings.about.dark') },
    { value: 'system', icon: <Monitor size={14} />, label: t('settings.about.system') },
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

function ShortcutRow({ keys, description, noBorder }: { keys: string; description: string; noBorder?: boolean | undefined }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0',
      borderBottom: noBorder ? 'none' : '1px solid var(--border-subtle)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{description}</span>
      <kbd style={{
        fontSize: 11, padding: '2px 6px', borderRadius: 3,
        background: 'var(--bg-surface-high, var(--bg-surface))',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-muted)', fontFamily: 'monospace',
      }}>
        {keys}
      </kbd>
    </div>
  );
}
