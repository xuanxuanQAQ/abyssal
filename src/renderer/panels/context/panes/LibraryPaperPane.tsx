/**
 * LibraryPaperPane — Library 选中论文上下文（§3.2）
 *
 * PaperQuickInfo → QuickActions → RecentAnnotations
 */

import React from 'react';
import { PaperQuickInfo } from '../cards/PaperQuickInfo';
import { QuickActions } from '../cards/QuickActions';
import { useAnnotations } from '../../../core/ipc/hooks/useAnnotations';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };
const borderTopStyle: React.CSSProperties = { borderTop: '1px solid var(--border-subtle)' };
const errorStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--danger)' };
const annotationSectionStyle: React.CSSProperties = { borderTop: '1px solid var(--border-subtle)', padding: '8px 12px' };
const annotationHeaderStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 };
const annotationItemStyle: React.CSSProperties = { padding: '4px 0', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' };
const pageRefStyle: React.CSSProperties = { color: 'var(--text-muted)' };

interface LibraryPaperPaneProps {
  paperId: string;
}

export const LibraryPaperPane = React.memo(function LibraryPaperPane({ paperId }: LibraryPaperPaneProps) {
  const { data: annotations, isError: annotationsError } = useAnnotations(paperId);
  const recentAnnotations = annotations?.slice(0, 5) ?? [];

  return (
    <div style={scrollContainerStyle}>
      <PaperQuickInfo paperId={paperId} />

      <div style={borderTopStyle}>
        <QuickActions paperId={paperId} />
      </div>

      {/* RecentAnnotations */}
      {annotationsError && (
        <div style={errorStyle}>
          加载标注失败
        </div>
      )}
      {recentAnnotations.length > 0 && (
        <div style={annotationSectionStyle}>
          <div style={annotationHeaderStyle}>
            最近标注
          </div>
          {recentAnnotations.map((ann) => (
            <div key={ann.id} style={annotationItemStyle}>
              <span style={pageRefStyle}>p.{ann.page}</span>
              {' '}{ann.selectedText?.slice(0, 80) ?? ann.text ?? '—'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
