import React from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Zap, Shield } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { PROVIDERS, PROVIDER_LABELS, MODELS_BY_PROVIDER, WORKFLOW_KEYS } from '../constants';
import { Section, Row, Select, NumberInput, Toggle, SegmentedControl } from '../components/ui';

export function AiModelsTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
  const { t } = useTranslation();
  const { llm, rag, ai } = settings;

  const handleDefaultProviderChange = (provider: string) => {
    const models = MODELS_BY_PROVIDER[provider];
    onUpdate('llm', {
      defaultProvider: provider,
      defaultModel: models && models.length > 0 ? models[0]! : llm.defaultModel,
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
  const { t } = useTranslation();
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
            placeholder={t('settings.aiModels.modelPlaceholder')}
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
