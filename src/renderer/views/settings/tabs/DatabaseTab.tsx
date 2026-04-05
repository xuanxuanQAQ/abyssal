import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, AlertTriangle, Loader2 } from 'lucide-react';
import type { SettingsData, DbStatsInfo } from '../../../../shared-types/models';
import { Section, Row } from '../components/ui';
import { getAPI } from '../../../core/ipc/bridge';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DatabaseTab({ settings }: { settings: SettingsData }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DbStatsInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAPI().settings.getDbStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

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
