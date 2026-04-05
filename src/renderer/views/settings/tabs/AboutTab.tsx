import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Keyboard } from 'lucide-react';
import type { SystemInfo } from '../../../../shared-types/models';
import { Section, Row } from '../components/ui';
import { getAPI } from '../../../core/ipc/bridge';

export function AboutTab() {
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
