import React, { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Key, Loader2, Check, X } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import { Section, StatusBadge } from '../components/ui';
import { getAPI } from '../../../core/ipc/bridge';

export function ApiKeysTab({ settings, onReload }: { settings: SettingsData; onReload: () => void }) {
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
    } catch (err) {
      toast.error(t('settings.apiKeys.saveFailed', { message: (err as Error).message }));
    }
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
