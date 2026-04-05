import React from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Cpu } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { Section, Row, Toggle, SliderRow } from '../components/ui';

export function AnalysisTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
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
