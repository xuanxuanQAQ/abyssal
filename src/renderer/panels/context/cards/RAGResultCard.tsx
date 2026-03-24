/**
 * RAGResultCard -- single RAG material card (updated v1.2)
 *
 * Shows source paper + page + relevance + paragraph snippet.
 * v1.2: retrieval path badge, section title/type, collapsible context before/after.
 * Actions: insert citation / view in Reader / expand full text
 */

import { useState } from 'react';
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

export function RAGResultCard({ result, sectionTitle }: RAGResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const handleInsert = () => {
    // TODO: integrate with useEditorStore.insertAtCursor (Sub-Doc 7 Writing)
    setInserted(true);
    toast.success(`素材已插入${sectionTitle ? ` ${sectionTitle}` : ''}`);
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

  return (
    <div
      style={{
        margin: '4px 12px',
        padding: '8px 10px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-xs)',
      }}
    >
      {/* Source row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <FileText size={10} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 4,
            color: 'var(--text-muted)',
            fontSize: 10,
          }}
        >
          {result.sectionTitle && (
            <span>{result.sectionTitle}</span>
          )}
          {result.sectionType && (
            <span
              style={{
                padding: '0 4px',
                backgroundColor: 'var(--bg-surface-low)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {result.sectionType}
            </span>
          )}
        </div>
      )}

      {/* Relevance score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <span style={{ color: 'var(--text-muted)' }}>相关度:</span>
        <div style={{ flex: 1, height: 3, backgroundColor: 'var(--bg-surface-low)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${result.score * 100}%`, backgroundColor: 'var(--accent-color)' }} />
        </div>
        <span>{result.score.toFixed(2)}</span>
      </div>

      {/* Text snippet */}
      <div
        style={{
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          maxHeight: expanded ? undefined : 48,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        &quot;{result.text}&quot;
      </div>

      {result.text.length > 160 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
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
          }}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded ? '收起' : '展开全文'}
        </button>
      )}

      {/* Collapsible context before/after */}
      {hasContext && (
        <>
          <button
            onClick={() => setShowContext(!showContext)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 10,
              cursor: 'pointer',
              padding: 0,
              marginBottom: showContext ? 4 : 6,
            }}
          >
            {showContext ? (
              <ChevronDown size={10} />
            ) : (
              <ChevronRight size={10} />
            )}
            上下文
          </button>
          {showContext && (
            <div
              style={{
                marginBottom: 6,
                padding: '4px 8px',
                backgroundColor: 'var(--bg-surface-low)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                fontSize: 10,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}
            >
              {result.contextBefore && (
                <div style={{ marginBottom: result.contextAfter ? 4 : 0 }}>
                  <span style={{ fontWeight: 600 }}>Before: </span>
                  {result.contextBefore}
                </div>
              )}
              {result.contextAfter && (
                <div>
                  <span style={{ fontWeight: 600 }}>After: </span>
                  {result.contextAfter}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleInsert}
          disabled={inserted}
          style={{
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
          }}
        >
          {inserted ? <><Check size={10} /> 已插入</> : '插入引用'}
        </button>
        <button
          onClick={handleOpenInReader}
          style={{
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
          }}
        >
          <ArrowRight size={10} /> 在 Reader 中查看
        </button>
      </div>
    </div>
  );
}
