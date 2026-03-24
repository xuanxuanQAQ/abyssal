/**
 * LibraryPaperPane — Library 选中论文上下文（§3.2）
 *
 * PaperQuickInfo → QuickActions → RecentAnnotations
 */

import React from 'react';
import { PaperQuickInfo } from '../cards/PaperQuickInfo';
import { QuickActions } from '../cards/QuickActions';
import { useAnnotations } from '../../../core/ipc/hooks/useAnnotations';

interface LibraryPaperPaneProps {
  paperId: string;
}

export function LibraryPaperPane({ paperId }: LibraryPaperPaneProps) {
  const { data: annotations, isError: annotationsError } = useAnnotations(paperId);
  const recentAnnotations = annotations?.slice(0, 5) ?? [];

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <PaperQuickInfo paperId={paperId} />

      <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <QuickActions paperId={paperId} />
      </div>

      {/* RecentAnnotations */}
      {annotationsError && (
        <div style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
          加载标注失败
        </div>
      )}
      {recentAnnotations.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '8px 12px' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            最近标注
          </div>
          {recentAnnotations.map((ann) => (
            <div
              key={ann.id}
              style={{
                padding: '4px 0',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>p.{ann.page}</span>
              {' '}{ann.selectedText?.slice(0, 80) ?? ann.text ?? '—'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
