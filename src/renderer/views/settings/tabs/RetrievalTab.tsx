import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Search, BarChart3, DollarSign, AlertTriangle, RefreshCw } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { Section, Row, Select, NumberInput, SegmentedControl, SliderRow } from '../components/ui';
import {
  EMBEDDING_MODEL_REGISTRY,
  defaultModelForProvider,
  type EmbeddingProvider,
} from '../../../../core/config/config-schema';
import { useAppDialog } from '../../../shared/useAppDialog';
import { getAPI } from '../../../core/ipc/bridge';

export function RetrievalTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
  const { t } = useTranslation();
  const { confirm, dialog } = useAppDialog();
  const { rag, contextBudget, discovery } = settings;
  const [rebuilding, setRebuilding] = useState(false);

  return (
    <>
      <Section icon={<Database size={16} />} title={t('settings.retrieval.embeddingModel')} description={t('settings.retrieval.embeddingModelDesc')}>
        <Row label={t('settings.aiModels.provider')}>
          <SegmentedControl
            value={rag.embeddingProvider ?? 'openai'}
            options={[
              { value: 'siliconflow', label: 'SiliconFlow' },
              { value: 'jina', label: 'Jina' },
              { value: 'openai', label: 'OpenAI' },
            ]}
            onChange={async (v) => {
              const provider = v as EmbeddingProvider;
              if (provider === (rag.embeddingProvider ?? 'openai')) return;
              const def = defaultModelForProvider(provider);
              const confirmed = await confirm({
                title: t('settings.retrieval.embeddingModel'),
                description: t('settings.retrieval.embeddingChangeConfirm'),
                confirmLabel: t('common.confirm'),
                confirmTone: 'danger',
              });
              if (!confirmed) return;
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
            onChange={async (v) => {
              if (v === rag.embeddingModel) return;
              const confirmed = await confirm({
                title: t('settings.retrieval.embeddingModel'),
                description: t('settings.retrieval.embeddingChangeConfirm'),
                confirmLabel: t('common.confirm'),
                confirmTone: 'danger',
              });
              if (!confirmed) return;
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
        <Row label={t('settings.retrieval.rebuildIntentEmbeddings')} hint={t('settings.retrieval.rebuildIntentEmbeddingsHint')}>
          <button
            disabled={rebuilding}
            onClick={async () => {
              setRebuilding(true);
              try {
                await getAPI().settings.rebuildIntentEmbeddings();
                // Simple inline feedback
                alert(t('settings.retrieval.rebuildIntentEmbeddingsSuccess'));
              } catch {
                alert(t('settings.retrieval.rebuildIntentEmbeddingsFailed'));
              } finally {
                setRebuilding(false);
              }
            }}
            style={{
              padding: '4px 12px', fontSize: 12,
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated, transparent)',
              color: 'var(--text-secondary)',
              cursor: rebuilding ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: rebuilding ? 0.6 : 1,
            }}
          >
            <RefreshCw size={12} style={rebuilding ? { animation: 'spin 1s linear infinite' } : undefined} />
            {rebuilding ? t('settings.retrieval.rebuilding') : t('settings.retrieval.rebuildIntentEmbeddings')}
          </button>
        </Row>
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
        <Row label={t('settings.retrieval.backend')}>
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
        <Row label={t('settings.retrieval.rerankerModel')} hint={t('settings.retrieval.rerankerModelHint')}>
          <input
            type="text"
            value={rag.rerankerModel ?? ''}
            onChange={(e) => onUpdate('rag', { rerankerModel: e.target.value.trim() || null })}
            placeholder={t('settings.aiModels.modelPlaceholder')}
            style={{
              width: 220, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          />
        </Row>
        <SliderRow
          label={t('settings.retrieval.crossConceptBoostFactor')}
          hint={t('settings.retrieval.crossConceptBoostFactorHint')}
          value={rag.crossConceptBoostFactor}
          min={1}
          max={3}
          step={0.1}
          onChange={(v) => onUpdate('rag', { crossConceptBoostFactor: v })}
        />
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
        <SliderRow
          label={t('settings.retrieval.outputReserveRatio')}
          hint={t('settings.retrieval.outputReserveRatioHint')}
          value={contextBudget.outputReserveRatio}
          min={0.05}
          max={0.5}
          step={0.01}
          onChange={(v) => onUpdate('contextBudget', { outputReserveRatio: v })}
        />
        <SliderRow
          label={t('settings.retrieval.safetyMarginRatio')}
          hint={t('settings.retrieval.safetyMarginRatioHint')}
          value={contextBudget.safetyMarginRatio}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(v) => onUpdate('contextBudget', { safetyMarginRatio: v })}
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
      {dialog}
    </>
  );
}
