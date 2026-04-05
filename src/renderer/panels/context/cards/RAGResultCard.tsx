/**
 * RAGResultCard -- single RAG material card (updated v1.2)
 *
 * Shows source paper + page + relevance + paragraph snippet.
 * v1.2: retrieval path badge, section title/type, collapsible context before/after.
 * Actions: insert citation / view in Reader / expand full text
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Check,
  Database,
  Search,
  BookMarked,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore } from '../../../core/store';
import { requestCitationInsert } from '../../../views/writing/shared/citationActions';
import type { RAGResult } from '../../../../shared-types/models';
import type { RetrievalPath } from '../../../../shared-types/enums';

interface RAGResultCardProps {
  result: RAGResult;
  sectionTitle?: string | undefined;
}

function getPathIcon(path: RetrievalPath) {
  switch (path) {
    case 'vector':
      return <Search size={10} />;
    case 'structured':
      return <Database size={10} />;
    case 'annotation':
      return <BookMarked size={10} />;
    default:
      return <Search size={10} />;
  }
}

function getPathLabel(path: RetrievalPath): string {
  switch (path) {
    case 'vector':
      return 'Vector';
    case 'structured':
      return 'Structured';
    case 'annotation':
      return 'Annotation';
    default:
      return 'Unknown';
  }
}

function getPathColor(path: RetrievalPath): string {
  switch (path) {
    case 'vector':
      return 'var(--accent-color)';
    case 'structured':
      return 'var(--success, #38a169)';
    case 'annotation':
      return 'var(--warning, #d69e2e)';
    default:
      return 'var(--text-muted)';
  }
}

// ── Static styles ──

const cardBaseStyle: React.CSSProperties = {
  margin: '10px 12px',
  padding: '14px 16px',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', // more rounded, softer
  fontSize: 'var(--text-sm)',
  transition: 'transform var(--duration-normal) var(--easing-spring), box-shadow var(--duration-normal) var(--easing-spring), border-color var(--duration-normal) var(--easing-default)',
  position: 'relative',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 8,
  marginBottom: 8,
};

const sourceTitleContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0, // Enable ellipsis
  color: 'var(--text-primary)',
  fontWeight: 600,
  fontSize: 'var(--text-sm)',
};

const fileIconStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  flexShrink: 0,
};

const sourceTitleStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px 12px',
  marginBottom: 12,
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs)',
};

const badgeStyle = (path: RetrievalPath): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: '12px',
  backgroundColor: 'var(--bg-surface-low)', // subtler than explicit borders
  border: `1px solid ${getPathColor(path)}40`, // 25% opacity border
  color: getPathColor(path),
  fontSize: '10px',
  lineHeight: 1,
  flexShrink: 0,
});

const relevanceGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const relevanceBarTrackStyle: React.CSSProperties = {
  width: 48,
  height: 4,
  backgroundColor: 'var(--bg-surface-high)',
  borderRadius: 2,
  overflow: 'hidden',
};

const expandBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  color: 'var(--accent-color)',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  padding: 0,
  marginTop: 6,
  transition: 'opacity var(--duration-fast)',
};

const contextBtnStyle: React.CSSProperties = {
  ...expandBtnStyle,
  color: 'var(--text-muted)',
  marginLeft: 16,
};

const contextBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '10px 14px',
  backgroundColor: 'var(--bg-surface-lowest)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 16,
};

const btnHoverTransition = 'all var(--duration-fast) var(--easing-default)';

const fontWeightBold: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--text-primary)',
};

export const RAGResultCard = React.memo(function RAGResultCard({ result, sectionTitle }: RAGResultCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const handleInsert = () => {
    const success = requestCitationInsert(result.paperId);
    setInserted(true);
    if (success) {
      toast.success(t('context.rag.inserted', { section: sectionTitle ?? '' }));
    } else {
      toast.error(t('context.rag.noActiveEditor', 'No active editor to insert citation'));
    }
  };

  const handleOpenInReader = () => {
    navigateTo({
      type: 'paper',
      id: result.paperId,
      view: 'reader',
      pdfPage: result.page,
    });
  };

  const hasContext = Boolean(result.contextBefore ?? result.contextAfter);

  const snippetStyle: React.CSSProperties = {
    color: 'var(--text-primary)',
    fontSize: '13px',         // Improved typographic scale for reading
    lineHeight: 1.65,         // Academic reading standard
    maxHeight: expanded ? undefined : 64, // Approximately 3 lines
    overflow: 'hidden',
    position: 'relative',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const relevanceBarFillStyle: React.CSSProperties = {
    height: '100%',
    width: `${result.score * 100}%`,
    backgroundColor: 'var(--accent-color)',
    borderRadius: 2,
  };

  const insertBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: inserted ? 'var(--bg-surface-low)' : 'var(--bg-surface)',
    color: inserted ? 'var(--text-muted)' : 'var(--text-primary)',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    cursor: inserted ? 'default' : 'pointer',
    transition: btnHoverTransition,
    opacity: inserted ? 0.7 : 1,
  };

  const viewInReaderBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--accent-color)',
    color: '#fff', // always white
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    cursor: 'pointer',
    transition: btnHoverTransition,
  };

  return (
    <div 
      style={{
        ...cardBaseStyle,
        transform: isHovered ? 'translateY(-2px)' : 'none',
        boxShadow: isHovered ? 'var(--shadow-md)' : 'none',
        borderColor: isHovered ? 'var(--border-default)' : 'var(--border-subtle)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 1. Header row: Source title & Path badge */}
      <div style={headerRowStyle}>
        <div style={sourceTitleContainerStyle}>
          <FileText size={14} style={fileIconStyle} />
          <span style={sourceTitleStyle} title={result.paperTitle}>
            {result.paperTitle}, p.{result.page}
          </span>
        </div>
        {result.retrievalPath && (
          <div style={badgeStyle(result.retrievalPath)}>
            {getPathIcon(result.retrievalPath)}
            {getPathLabel(result.retrievalPath)}
          </div>
        )}
      </div>

      {/* 2. Metadata row: Relevance, Section Info */}
      <div style={metaRowStyle}>
        <div style={relevanceGroupStyle} title={`${t('context.rag.relevance')}: ${(result.score * 100).toFixed(0)}%`}>
          <div style={relevanceBarTrackStyle}>
            <div style={relevanceBarFillStyle} />
          </div>
          <span>{result.score.toFixed(2)}</span>
        </div>

        {(result.sectionTitle ?? result.sectionType) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ opacity: 0.4 }}>•</span>
            {result.sectionType && (
              <span style={{ 
                padding: '2px 6px', 
                backgroundColor: 'var(--bg-surface-low)', 
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                fontSize: '10px'
              }}>
                {result.sectionType}
              </span>
            )}
            {result.sectionTitle && (
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                {result.sectionTitle}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 3. Text snippet */}
      <div style={snippetStyle}>
        {result.text}
        {/* Soft fade out for collapsed text */}
        {!expanded && result.text.length > 160 && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 24,
            background: 'linear-gradient(to bottom, transparent, var(--bg-surface))',
            pointerEvents: 'none',
          }} />
        )}
      </div>

      {/* 4. Expand / Context Controls */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {result.text.length > 160 && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={expandBtnStyle}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {expanded ? t('common.collapse', 'Collapse') : t('context.rag.expandFull', 'Read more')}
          </button>
        )}

        {hasContext && (
          <button
            onClick={() => setShowContext(!showContext)}
            style={contextBtnStyle}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            {showContext ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t('context.rag.context', 'Surrounding context')}
          </button>
        )}
      </div>

      {/* Context before/after box */}
      {hasContext && showContext && (
        <div style={contextBoxStyle}>
          {result.contextBefore && (
            <div style={{ marginBottom: result.contextAfter ? 12 : 0 }}>
              <span style={fontWeightBold}>Before: </span>
              {result.contextBefore}
            </div>
          )}
          {result.contextAfter && (
            <div>
              <span style={fontWeightBold}>After: </span>
              {result.contextAfter}
            </div>
          )}
        </div>
      )}

      {/* 5. Action buttons */}
      <div style={actionRowStyle}>
        <button
          onClick={handleInsert}
          disabled={inserted}
          style={insertBtnStyle}
          onMouseEnter={(e) => { if (!inserted) e.currentTarget.style.backgroundColor = 'var(--bg-surface-low)'; }}
          onMouseLeave={(e) => { if (!inserted) e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; }}
        >
          {inserted ? (
            <><Check size={14} /> {t('context.rag.alreadyInserted', 'Inserted')}</>
          ) : (
            <><BookMarked size={14} /> {t('context.rag.insertCitation', 'Cite')}</>
          )}
        </button>
        <button
          onClick={handleOpenInReader}
          style={viewInReaderBtnStyle}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-color)'}
        >
          <ArrowRight size={14} /> {t('context.rag.viewInReader', 'Open PDF')}
        </button>
      </div>
    </div>
  );
});
