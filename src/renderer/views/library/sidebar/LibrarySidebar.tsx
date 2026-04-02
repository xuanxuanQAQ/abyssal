/**
 * LibrarySidebar — 侧边栏容器（§2.1）
 *
 * 三个可折叠区域：SmartGroups + TagTree + SearchHistory。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SmartGroups } from './SmartGroups';
import { TagTree } from './TagTree';
import { SearchHistory } from './SearchHistory';
import type { PaperCounts } from '../../../../shared-types/models';

interface LibrarySidebarProps {
  counts: PaperCounts | null;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="library-sidebar-section">
      <button
        onClick={() => setOpen(!open)}
        className="library-sidebar-section-trigger"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          padding: '6px 12px',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
      </button>
      {open && <div className="library-sidebar-section-body">{children}</div>}
    </div>
  );
}

export function LibrarySidebar({ counts }: LibrarySidebarProps) {
  const { t } = useTranslation();

  return (
    <nav
      className="workspace-lens-panel library-sidebar-shell"
      role="navigation"
      aria-label={t('library.sidebar.navigation')}
      style={{
        height: '100%',
        overflowY: 'auto',
        borderRight: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <CollapsibleSection title={t('library.sidebar.smartGroups')}>
        <SmartGroups counts={counts} />
      </CollapsibleSection>

      <div className="library-sidebar-divider" style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 12px' }} />

      <CollapsibleSection title={t('library.sidebar.tags')}>
        <TagTree />
      </CollapsibleSection>

      <div className="library-sidebar-divider" style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 12px' }} />

      <CollapsibleSection title={t('library.sidebar.searchHistory')} defaultOpen={false}>
        <SearchHistory />
      </CollapsibleSection>
    </nav>
  );
}
