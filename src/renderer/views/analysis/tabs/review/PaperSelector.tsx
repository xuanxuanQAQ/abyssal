/**
 * PaperSelector -- Dropdown listing completed papers sorted by relevance.
 *
 * Display format: "Author et al. Year -- Title" (truncated to fit).
 */

import React from 'react';

interface PaperSelectorProps {
  papers: Array<{
    id: string;
    title: string;
    authors: Array<{ name: string }>;
    year: number;
    relevance: string;
  }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function formatLabel(paper: PaperSelectorProps['papers'][number]): string {
  const firstAuthor = paper.authors[0]?.name ?? 'Unknown';
  const authorSuffix = paper.authors.length > 1 ? ' et al.' : '';
  const titleTruncated =
    paper.title.length > 60 ? paper.title.slice(0, 57) + '...' : paper.title;
  return `${firstAuthor}${authorSuffix} ${paper.year} \u2014 ${titleTruncated}`;
}

export function PaperSelector({ papers, selectedId, onSelect }: PaperSelectorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label
        htmlFor="paper-review-selector"
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
        }}
      >
        Paper:
      </label>
      <select
        id="paper-review-selector"
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          flex: 1,
          padding: '6px 10px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--bg-base)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
          minWidth: 0,
        }}
      >
        {papers.map((p) => (
          <option key={p.id} value={p.id}>
            {formatLabel(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
