/**
 * PaperSelector -- Dropdown listing completed papers sorted by relevance.
 *
 * Display format: "Author et al. Year -- Title" (truncated to fit).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthorDisplayThreshold, formatAuthorShort } from '../../../../core/hooks/useAuthorDisplay';

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

function formatLabel(paper: PaperSelectorProps['papers'][number], threshold: number): string {
  const authorStr = formatAuthorShort(
    paper.authors.map((a) => a.name),
    threshold,
  ) || 'Unknown';
  const titleTruncated =
    paper.title.length > 60 ? paper.title.slice(0, 57) + '...' : paper.title;
  return `${authorStr} ${paper.year} \u2014 ${titleTruncated}`;
}

export function PaperSelector({ papers, selectedId, onSelect }: PaperSelectorProps) {
  const { t } = useTranslation();
  const threshold = useAuthorDisplayThreshold();
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
        {t('analysis.review.paperLabel')}
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
            {formatLabel(p, threshold)}
          </option>
        ))}
      </select>
    </div>
  );
}
