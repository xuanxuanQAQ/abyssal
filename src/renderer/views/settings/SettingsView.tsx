/**
 * SettingsView — application configuration panel.
 *
 * Sections:
 * - Appearance (theme, accent color, font size)
 * - API Keys (providers: Anthropic, OpenAI, DeepSeek, Cohere, Jina)
 * - LLM Preferences (default provider/model)
 * - Workspace (current path, open folder)
 * - Keyboard shortcuts (read-only display)
 * - About (version info)
 *
 * See spec: section 3.1 (Settings route)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Sun, Moon, Monitor, Key, Cpu, FolderOpen, Keyboard, Info } from 'lucide-react';
import { useTheme } from '../../core/context/ThemeContext';
import { getAPI } from '../../core/ipc/bridge';

// ─── Types ───

interface AppConfig {
  language: string;
  llmProvider: string;
  llmModel: string;
  workspacePath: string;
}

// ─── SettingsView ───

export function SettingsView() {
  const { colorScheme, setColorScheme } = useTheme();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getAPI().app.getConfig().then((c: unknown) => {
      setConfig(c as AppConfig);
    }).catch(() => {});

    // Check which API keys are configured (without revealing the keys)
    getAPI().app.getProjectInfo().then((info: unknown) => {
      const i = info as Record<string, unknown>;
      setApiKeyStatus({
        anthropic: !!i['hasAnthropicKey'],
        openai: !!i['hasOpenaiKey'],
        deepseek: !!i['hasDeepseekKey'],
      });
    }).catch(() => {});
  }, []);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px 32px', maxWidth: 720 }}>
      <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 24 }}>
        Settings
      </h1>

      {/* ── Appearance ── */}
      <SettingsSection icon={<Sun size={16} />} title="Appearance">
        <SettingsRow label="Theme">
          <ThemeSelector value={colorScheme} onChange={setColorScheme} />
        </SettingsRow>
      </SettingsSection>

      {/* ── API Keys ── */}
      <SettingsSection icon={<Key size={16} />} title="API Keys">
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          API keys are stored in the global config file (~/.abyssal/global.toml).
          Edit the file directly to add or change keys.
        </p>
        <ApiKeyRow provider="Anthropic (Claude)" {...(apiKeyStatus['anthropic'] != null && { configured: apiKeyStatus['anthropic'] })} />
        <ApiKeyRow provider="OpenAI (GPT)" {...(apiKeyStatus['openai'] != null && { configured: apiKeyStatus['openai'] })} />
        <ApiKeyRow provider="DeepSeek" {...(apiKeyStatus['deepseek'] != null && { configured: apiKeyStatus['deepseek'] })} />
      </SettingsSection>

      {/* ── LLM Preferences ── */}
      <SettingsSection icon={<Cpu size={16} />} title="LLM Preferences">
        <SettingsRow label="Default Provider">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {config?.llmProvider ?? '—'}
          </span>
        </SettingsRow>
        <SettingsRow label="Default Model">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {config?.llmModel ?? '—'}
          </span>
        </SettingsRow>
      </SettingsSection>

      {/* ── Workspace ── */}
      <SettingsSection icon={<FolderOpen size={16} />} title="Workspace">
        <SettingsRow label="Current Workspace">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            {config?.workspacePath ?? '—'}
          </span>
        </SettingsRow>
      </SettingsSection>

      {/* ── Keyboard Shortcuts ── */}
      <SettingsSection icon={<Keyboard size={16} />} title="Keyboard Shortcuts">
        <ShortcutRow keys="Ctrl+1–6" description="Switch views" />
        <ShortcutRow keys="Ctrl+B" description="Toggle context panel" />
        <ShortcutRow keys="Ctrl+Shift+N" description="Quick memo" />
        <ShortcutRow keys="Ctrl+K" description="Global search" />
        <ShortcutRow keys="Escape" description="Close overlays" />
      </SettingsSection>

      {/* ── About ── */}
      <SettingsSection icon={<Info size={16} />} title="About">
        <SettingsRow label="Version">
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>1.3.0</span>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

// ─── Sub-components ───

function SettingsSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--text-primary)' }}>
        {icon}
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: 0 }}>{title}</h2>
      </div>
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

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
      {children}
    </div>
  );
}

function ThemeSelector({ value, onChange }: { value: string; onChange: (v: 'light' | 'dark' | 'system') => void }) {
  const options: Array<{ value: 'light' | 'dark' | 'system'; icon: React.ReactNode; label: string }> = [
    { value: 'light', icon: <Sun size={14} />, label: 'Light' },
    { value: 'dark', icon: <Moon size={14} />, label: 'Dark' },
    { value: 'system', icon: <Monitor size={14} />, label: 'System' },
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

function ApiKeyRow({ provider, configured }: { provider: string; configured?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{provider}</span>
      <span style={{
        fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm, 4px)',
        background: configured ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        color: configured ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
      }}>
        {configured ? 'Configured' : 'Not set'}
      </span>
    </div>
  );
}

function ShortcutRow({ keys, description }: { keys: string; description: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
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
