/**
 * PaperQuickInfo — 论文速览卡片（§3.4）
 *
 * 在 Library、Reader、Graph 三个视图的 ContextPane 中复用。
 * 显示：标题、作者、状态、摘要、标签、DOI。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

// ── Static styles ──

const containerStyle: React.CSSProperties = {
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const loadingStyle: React.CSSProperties = {
  padding: 12,
  color: 'var(--text-muted)',
  fontSize: 'var(--text-sm)',
};

const yearBadgeStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  fontWeight: 400,
};

const authorRowStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const paperTypeBadgeStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '1px 6px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-xs)',
};

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--text-xs)',
};

const abstractContainerStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

const expandButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent-color)',
  cursor: 'pointer',
  fontSize: 'var(--text-xs)',
  padding: 0,
  marginTop: 2,
};

const tagsContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'nowrap',
  overflowX: 'auto',
};

const tagStyle: React.CSSProperties = {
  padding: '1px 8px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const doiRowStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const doiIconStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
};

const doiLinkStyle: React.CSSProperties = {
  color: 'var(--accent-color)',
  textDecoration: 'none',
};

export const PaperQuickInfo = React.memo(function PaperQuickInfo({ paperId }: PaperQuickInfoProps) {
  const { t } = useTranslation();
  const { data: paper, isLoading } = usePaper(paperId);
  const [abstractExpanded, setAbstractExpanded] = useState(false);

  if (isLoading || !paper) {
    return (
      <div style={loadingStyle}>
        {t('context.paperInfo.loading')}
      </div>
    );
  }

  const rel = getRelevanceIcon(paper.relevance);
  const firstAuthor = paper.authors[0]?.name ?? t('context.paperInfo.unknownAuthor');
  const abstractText = paper.abstract ?? '';
  const showExpand = abstractText.length > 200;

  const titleStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    display: '-webkit-box',
    WebkitLineClamp: abstractExpanded ? undefined : 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };

  const fulltextBadgeStyle: React.CSSProperties = {
    padding: '1px 6px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor:
      paper.fulltextStatus === 'available'
        ? 'rgba(34,197,94,0.15)'
        : 'rgba(234,179,8,0.15)',
    color:
      paper.fulltextStatus === 'available' ? 'var(--success)' : 'var(--warning)',
  };

  const analysisBadgeStyle: React.CSSProperties = {
    padding: '1px 6px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor:
      paper.analysisStatus === 'completed'
        ? 'rgba(34,197,94,0.15)'
        : 'rgba(59,130,246,0.15)',
    color:
      paper.analysisStatus === 'completed' ? 'var(--success)' : 'var(--accent-color)',
  };

  const abstractBoxStyle: React.CSSProperties = {
    maxHeight: abstractExpanded ? undefined : 60,
    overflow: 'hidden',
  };

  return (
    <div style={containerStyle}>
      {/* 标题 */}
      <div style={titleStyle}>
        {paper.title}
        <span style={yearBadgeStyle}>
          {paper.year}
        </span>
      </div>

      {/* 作者行 */}
      <div style={authorRowStyle}>
        {firstAuthor}
        {paper.authors.length > 1 && ' et al.'}
        <span style={paperTypeBadgeStyle}>
          {paper.paperType}
        </span>
      </div>

      {/* 状态行 */}
      <div style={statusRowStyle}>
        <span style={{ color: rel.color }} title={`Relevance: ${paper.relevance}`}>
          {rel.label === '✗' ? <XIcon size={12} /> : <Star size={12} />}
        </span>
        <span style={fulltextBadgeStyle}>
          {t('context.paperInfo.fulltext')}: {paper.fulltextStatus}
        </span>
        <span style={analysisBadgeStyle}>
          {t('context.paperInfo.analysis')}: {paper.analysisStatus}
        </span>
      </div>

      {/* 摘要区 */}
      {abstractText && (
        <div style={abstractContainerStyle}>
          <div style={abstractBoxStyle}>
            {abstractText}
          </div>
          {showExpand && (
            <button
              onClick={() => setAbstractExpanded(!abstractExpanded)}
              style={expandButtonStyle}
            >
              {abstractExpanded ? t('common.collapse') : t('common.expand')}
            </button>
          )}
        </div>
      )}

      {/* 标签行 */}
      {paper.tags.length > 0 && (
        <div style={tagsContainerStyle}>
          {paper.tags.map((tag) => (
            <span key={tag} style={tagStyle}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* DOI 行 */}
      {paper.doi && (
        <div style={doiRowStyle}>
          <ExternalLink size={10} style={doiIconStyle} />
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            style={doiLinkStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {paper.doi}
          </a>
        </div>
      )}
    </div>
  );
});
