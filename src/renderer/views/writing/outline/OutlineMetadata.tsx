/**
 * OutlineMetadata -- fixed panel below the outline tree
 *
 * Displays article metadata fields + aggregated progress:
 *   - Writing style dropdown
 *   - Citation style dropdown
 *   - Total word count (sum across all sections)
 *   - Progress bar (non-pending sections / total)
 */

import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DraftOutline, SectionNode } from '../../../../shared-types/models';
import type { CitationStyle } from '../../../../shared-types/enums';
import { useUpdateDraft } from '../../../core/ipc/hooks/useDrafts';

interface OutlineMetadataProps {
  draft: DraftOutline;
}

const WRITING_STYLES = [
  'academic',
  'narrative',
  'analytical',
  'descriptive',
  'argumentative',
] as const;

const CITATION_STYLES: CitationStyle[] = [
  'GB/T 7714',
  'APA',
  'IEEE',
  'Chicago',
];

// ── helpers ──

function countAllSections(sections: SectionNode[]): {
  total: number;
  nonPending: number;
  wordCount: number;
} {
  let total = 0;
  let nonPending = 0;
  let wordCount = 0;

  const stack = [...sections];
  while (stack.length > 0) {
    const node = stack.pop()!;
    total += 1;
    if (node.status !== 'pending') nonPending += 1;
    wordCount += node.wordCount;
    for (const child of node.children) {
      stack.push(child);
    }
  }

  return { total, nonPending, wordCount };
}

// ── styles ──

const panelStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  flexShrink: 0,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const labelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 'var(--text-sm)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  outline: 'none',
};

const progressBarOuterStyle: React.CSSProperties = {
  width: '100%',
  height: 6,
  backgroundColor: 'var(--border-subtle)',
  borderRadius: 3,
  overflow: 'hidden',
};

export function OutlineMetadata({ draft }: OutlineMetadataProps) {
  const { t } = useTranslation();
  const updateDraft = useUpdateDraft();

  const { total, nonPending, wordCount } = useMemo(
    () => countAllSections(draft.sections),
    [draft.sections],
  );

  const progressPct = total > 0 ? Math.round((nonPending / total) * 100) : 0;

  const handleWritingStyleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateDraft.mutate({
        draftId: draft.id,
        patch: {
          metadata: {
            ...draft.metadata,
            writingStyle: e.target.value || undefined,
          },
        },
      });
    },
    [draft.id, draft.metadata, updateDraft],
  );

  const handleCitationStyleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateDraft.mutate({
        draftId: draft.id,
        patch: {
          metadata: {
            ...draft.metadata,
            citationStyle: e.target.value as CitationStyle,
          },
        },
      });
    },
    [draft.id, draft.metadata, updateDraft],
  );

  return (
    <div style={panelStyle}>
      {/* Writing style */}
      <div style={rowStyle}>
        <span style={labelStyle}>{t('writing.metadata.writingStyle')}</span>
        <select
          style={selectStyle}
          value={draft.metadata.writingStyle ?? ''}
          onChange={handleWritingStyleChange}
        >
          <option value="">--</option>
          {WRITING_STYLES.map((ws) => (
            <option key={ws} value={ws}>
              {ws}
            </option>
          ))}
        </select>
      </div>

      {/* Citation style */}
      <div style={rowStyle}>
        <span style={labelStyle}>{t('writing.metadata.citationFormat')}</span>
        <select
          style={selectStyle}
          value={draft.metadata.citationStyle ?? 'GB/T 7714'}
          onChange={handleCitationStyleChange}
        >
          {CITATION_STYLES.map((cs) => (
            <option key={cs} value={cs}>
              {cs}
            </option>
          ))}
        </select>
      </div>

      {/* Word count */}
      <div style={rowStyle}>
        <span style={labelStyle}>{t('writing.metadata.totalWords')}</span>
        <span>{wordCount.toLocaleString()}</span>
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('writing.metadata.progress')}</span>
          <span>
            {nonPending}/{total} ({progressPct}%)
          </span>
        </div>
        <div style={progressBarOuterStyle}>
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              backgroundColor: 'var(--accent-color)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>
    </div>
  );
}
