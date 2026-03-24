/**
 * LibrarySidebar — 侧边栏容器（§2.1）
 *
 * 三个可折叠区域：SmartGroups + TagTree + SearchHistory。
 */

import React, { useState } from 'react';
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
    <div>
      <button
        onClick={() => setOpen(!open)}
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
      {open && children}
    </div>
  );
}

export function LibrarySidebar({ counts }: LibrarySidebarProps) {
  return (
    <nav
      role="navigation"
      aria-label="文献库导航"
      style={{
        height: '100%',
        overflowY: 'auto',
        borderRight: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <CollapsibleSection title="智能分组">
        <SmartGroups counts={counts} />
      </CollapsibleSection>

      <div style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 12px' }} />

      <CollapsibleSection title="标签">
        <TagTree />
      </CollapsibleSection>

      <div style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 12px' }} />

      <CollapsibleSection title="搜索历史" defaultOpen={false}>
        <SearchHistory />
      </CollapsibleSection>
    </nav>
  );
}
