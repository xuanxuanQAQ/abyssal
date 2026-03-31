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

const cardContainerStyle: React.CSSProperties = {
  margin: '4px 12px',
  padding: '8px 10px',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-xs)',
};

const sourceRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginBottom: 4,
};

const fileIconStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
};

const sourceTitleStyle: React.CSSProperties = {
  fontWeight: 500,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sectionMetadataStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
  color: 'var(--text-muted)',
  fontSize: 10,
};

const sectionTypeBadgeStyle: React.CSSProperties = {
  padding: '0 4px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
};

const relevanceRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginBottom: 6,
};

const relevanceLabelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
};

const relevanceBarTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 3,
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 2,
  overflow: 'hidden',
};

const expandBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  background: 'none',
  border: 'none',
  color: 'var(--accent-color)',
  fontSize: 'var(--text-xs)',
  cursor: 'pointer',
  padding: 0,
  marginBottom: 6,
};

const contextBtnBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: 10,
  cursor: 'pointer',
  padding: 0,
};

const contextBoxStyle: React.CSSProperties = {
  marginBottom: 6,
  padding: '4px 8px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
  fontSize: 10,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const viewInReaderBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'none',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs)',
  cursor: 'pointer',
};

const fontWeightBold: React.CSSProperties = {
  fontWeight: 600,
};

export const RAGResultCard = React.memo(function RAGResultCard({ result, sectionTitle }: RAGResultCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const handleInsert = () => {
    // TODO: integrate with useEditorStore.insertAtCursor (Sub-Doc 7 Writing)
    setInserted(true);
    toast.success(t('context.rag.inserted', { section: sectionTitle ?? '' }));
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
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    maxHeight: expanded ? undefined : 48,
    overflow: 'hidden',
    marginBottom: 6,
  };

  const relevanceBarFillStyle: React.CSSProperties = {
    height: '100%',
    width: `${result.score * 100}%`,
    backgroundColor: 'var(--accent-color)',
  };

  const insertBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 8px',
    border: '1px solid',
    borderColor: inserted ? 'var(--text-muted)' : 'var(--accent-color)',
    borderRadius: 'var(--radius-sm)',
    background: 'none',
    color: inserted ? 'var(--text-muted)' : 'var(--accent-color)',
    fontSize: 'var(--text-xs)',
    cursor: inserted ? 'default' : 'pointer',
  };

  const contextBtnStyle: React.CSSProperties = {
    ...contextBtnBaseStyle,
    marginBottom: showContext ? 4 : 6,
  };

  return (
    <div style={cardContainerStyle}>
      {/* Source row */}
      <div style={sourceRowStyle}>
        <FileText size={10} style={fileIconStyle} />
        <span style={sourceTitleStyle}>
          {result.paperTitle}, p.{result.page}
        </span>
        {/* Retrieval path badge */}
        {result.retrievalPath && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '1px 6px',
              borderRadius: 10,
              border: `1px solid ${getPathColor(result.retrievalPath)}`,
              color: getPathColor(result.retrievalPath),
              fontSize: 10,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {getPathIcon(result.retrievalPath)}
            {getPathLabel(result.retrievalPath)}
          </span>
        )}
      </div>

      {/* Section metadata */}
      {(result.sectionTitle ?? result.sectionType) && (
        <div style={sectionMetadataStyle}>
          {result.sectionTitle && (
            <span>{result.sectionTitle}</span>
          )}
          {result.sectionType && (
            <span style={sectionTypeBadgeStyle}>
              {result.sectionType}
            </span>
          )}
        </div>
      )}

      {/* Relevance score */}
      <div style={relevanceRowStyle}>
        <span style={relevanceLabelStyle}>{t('context.rag.relevance')}:</span>
        <div style={relevanceBarTrackStyle}>
          <div style={relevanceBarFillStyle} />
        </div>
        <span>{result.score.toFixed(2)}</span>
      </div>

      {/* Text snippet */}
      <div style={snippetStyle}>
        &quot;{result.text}&quot;
      </div>

      {result.text.length > 160 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={expandBtnStyle}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded ? t('common.collapse') : t('context.rag.expandFull')}
        </button>
      )}

      {/* Collapsible context before/after */}
      {hasContext && (
        <>
          <button
            onClick={() => setShowContext(!showContext)}
            style={contextBtnStyle}
          >
            {showContext ? (
              <ChevronDown size={10} />
            ) : (
              <ChevronRight size={10} />
            )}
            {t('context.rag.context')}
          </button>
          {showContext && (
            <div style={contextBoxStyle}>
              {result.contextBefore && (
                <div style={{ marginBottom: result.contextAfter ? 4 : 0 }}>
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
        </>
      )}

      {/* Action buttons */}
      <div style={actionRowStyle}>
        <button
          onClick={handleInsert}
          disabled={inserted}
          style={insertBtnStyle}
        >
          {inserted ? <><Check size={10} /> {t('context.rag.alreadyInserted')}</> : t('context.rag.insertCitation')}
        </button>
        <button
          onClick={handleOpenInReader}
          style={viewInReaderBtnStyle}
        >
          <ArrowRight size={10} /> {t('context.rag.viewInReader')}
        </button>
      </div>
    </div>
  );
});
