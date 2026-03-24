/**
 * TitleCell — 标题 + 展开箭头 + 搜索高亮（§6.1, §13）
 */

import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../../../core/store';
import { useSearchHighlight } from '../../hooks/useSearchHighlight';
import type { Paper } from '../../../../../shared-types/models';

interface TitleCellProps {
  paper: Paper;
  isExpanded: boolean;
  onToggleExpansion: () => void;
}

export function TitleCell({ paper, isExpanded, onToggleExpansion }: TitleCellProps) {
  const searchQuery = useAppStore((s) => s.librarySearchQuery);
  const segments = useSearchHighlight(paper.title, searchQuery);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', overflow: 'hidden' }}>
      {paper.abstract && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpansion();
          }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: 'var(--text-muted)',
            display: 'flex',
            flexShrink: 0,
          }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      )}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: isExpanded ? 'normal' : 'nowrap',
          fontSize: 'var(--text-sm)',
        }}
      >
        {segments.map((seg, i) =>
          seg.highlighted ? (
            <mark
              key={i}
              style={{
                backgroundColor: 'var(--warning)',
                opacity: 0.3,
                borderRadius: 2,
              }}
            >
              {seg.text}
            </mark>
          ) : (
            <React.Fragment key={i}>{seg.text}</React.Fragment>
          )
        )}
      </span>
    </div>
  );
}
