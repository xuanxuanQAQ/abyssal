import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, ExternalLink } from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { Section, Row } from '../components/ui';
import { getAPI } from '../../../core/ipc/bridge';

export function ProjectTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
  const { t } = useTranslation();
  const { project, workspace } = settings;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);

  // Sync local state when external settings change (e.g. save-failure rollback)
  useEffect(() => { setName(project.name); }, [project.name]);
  useEffect(() => { setDescription(project.description); }, [project.description]);

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
