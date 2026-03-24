/**
 * PaperQuickInfo — 论文速览卡片（§3.4）
 *
 * 在 Library、Reader、Graph 三个视图的 ContextPane 中复用。
 * 显示：标题、作者、状态、摘要、标签、DOI。
 */

import React, { useState } from 'react';
import { Star, X as XIcon, ExternalLink } from 'lucide-react';
import { usePaper } from '../../../core/ipc/hooks/usePapers';
import type { Relevance } from '../../../../shared-types/enums';

interface PaperQuickInfoProps {
  paperId: string;
}

function getRelevanceIcon(relevance: Relevance): { label: string; color: string } {
  switch (relevance) {
    case 'seed':
      return { label: '★', color: 'var(--accent-color)' };
    case 'high':
      return { label: '★', color: 'var(--success)' };
    case 'medium':
      return { label: '☆', color: 'var(--warning)' };
    case 'low':
      return { label: '☆', color: 'var(--text-muted)' };
    case 'excluded':
      return { label: '✗', color: 'var(--danger)' };
  }
}

export function PaperQuickInfo({ paperId }: PaperQuickInfoProps) {
  const { data: paper, isLoading } = usePaper(paperId);
  const [abstractExpanded, setAbstractExpanded] = useState(false);

  if (isLoading || !paper) {
    return (
      <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        加载论文信息…
      </div>
    );
  }

  const rel = getRelevanceIcon(paper.relevance);
  const firstAuthor = paper.authors[0]?.name ?? '未知作者';
  const abstractText = paper.abstract ?? '';
  const showExpand = abstractText.length > 200;

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 标题 */}
      <div
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: abstractExpanded ? undefined : 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {paper.title}
        <span
          style={{
            marginLeft: 6,
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            fontWeight: 400,
          }}
        >
          {paper.year}
        </span>
      </div>

      {/* 作者行 */}
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {firstAuthor}
        {paper.authors.length > 1 && ' et al.'}
        <span
          style={{
            marginLeft: 'auto',
            padding: '1px 6px',
            backgroundColor: 'var(--bg-surface-low)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {paper.paperType}
        </span>
      </div>

      {/* 状态行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)' }}>
        <span style={{ color: rel.color }} title={`Relevance: ${paper.relevance}`}>
          {rel.label === '✗' ? <XIcon size={12} /> : <Star size={12} />}
        </span>
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor:
              paper.fulltextStatus === 'available'
                ? 'rgba(34,197,94,0.15)'
                : 'rgba(234,179,8,0.15)',
            color:
              paper.fulltextStatus === 'available' ? 'var(--success)' : 'var(--warning)',
          }}
        >
          全文: {paper.fulltextStatus}
        </span>
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor:
              paper.analysisStatus === 'completed'
                ? 'rgba(34,197,94,0.15)'
                : 'rgba(59,130,246,0.15)',
            color:
              paper.analysisStatus === 'completed' ? 'var(--success)' : 'var(--accent-color)',
          }}
        >
          分析: {paper.analysisStatus}
        </span>
      </div>

      {/* 摘要区 */}
      {abstractText && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <div
            style={{
              maxHeight: abstractExpanded ? undefined : 60,
              overflow: 'hidden',
            }}
          >
            {abstractText}
          </div>
          {showExpand && (
            <button
              onClick={() => setAbstractExpanded(!abstractExpanded)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-color)',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                padding: 0,
                marginTop: 2,
              }}
            >
              {abstractExpanded ? '收起' : '展开'}
            </button>
          )}
        </div>
      )}

      {/* 标签行 */}
      {paper.tags.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'nowrap',
            overflowX: 'auto',
          }}
        >
          {paper.tags.map((tag) => (
            <span
              key={tag}
              style={{
                padding: '1px 8px',
                backgroundColor: 'var(--bg-surface-low)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* DOI 行 */}
      {paper.doi && (
        <div style={{ fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ExternalLink size={10} style={{ color: 'var(--text-muted)' }} />
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-color)', textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {paper.doi}
          </a>
        </div>
      )}
    </div>
  );
}
