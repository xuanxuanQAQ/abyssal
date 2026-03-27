/**
 * NoteNodeTooltip — hover tooltip for memo/note graph nodes.
 *
 * Shows memo text, associated entity tags, and "View in Notes" navigation link.
 *
 * See spec: section 2.9
 */

import React from 'react';
import { StickyNote, FileText, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import { EntityTag } from '../../../shared/EntityTag';

// ─── Props ───

interface NoteNodeTooltipProps {
  /** Node ID (memo or note ID) */
  nodeId: string;
  /** 'memo' or 'note' */
  nodeType: 'memo' | 'note';
  /** Memo text or note title */
  text: string;
  /** Associated paper IDs */
  paperIds: string[];
  /** Associated concept IDs */
  conceptIds: string[];
  /** Paper labels (id → title) for EntityTag rendering */
  paperLabels: Record<string, string>;
  /** Concept labels (id → name) for EntityTag rendering */
  conceptLabels: Record<string, string>;
  /** Pixel position for the tooltip */
  position: { x: number; y: number } | null;
}

// ─── Component ───

export function NoteNodeTooltip({
  nodeId,
  nodeType,
  text,
  paperIds,
  conceptIds,
  paperLabels,
  conceptLabels,
  position,
}: NoteNodeTooltipProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  if (!position) return null;

  const icon = nodeType === 'memo'
    ? <StickyNote size={12} style={{ color: '#a78bfa' }} />
    : <FileText size={12} style={{ color: '#7c3aed' }} />;

  const truncatedText = text.length > 200
    ? text.slice(0, 197) + '...'
    : text;

  const handleViewInNotes = () => {
    if (nodeType === 'memo') {
      navigateTo({ type: 'memo', memoId: nodeId });
    } else {
      navigateTo({ type: 'note', noteId: nodeId });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x + 12,
        top: position.y - 8,
        maxWidth: 320,
        padding: 10,
        background: 'var(--bg-surface, #1e293b)',
        border: '1px solid var(--border-default, var(--border-subtle))',
        borderRadius: 'var(--radius-md, 6px)',
        boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.3))',
        zIndex: 40,
        fontSize: 12,
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {icon}
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {nodeType}
        </span>
      </div>

      {/* Text */}
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
        {truncatedText}
      </div>

      {/* Associated entities */}
      {(paperIds.length > 0 || conceptIds.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {paperIds.map((pid) => (
            <EntityTag
              key={pid}
              type="paper"
              id={pid}
              label={paperLabels[pid] ?? pid.slice(0, 8)}
              maxChars={25}
            />
          ))}
          {conceptIds.map((cid) => (
            <EntityTag
              key={cid}
              type="concept"
              id={cid}
              label={conceptLabels[cid] ?? cid}
              maxChars={20}
            />
          ))}
        </div>
      )}

      {/* Navigation link */}
      <button
        onClick={handleViewInNotes}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', fontSize: 11,
          background: 'none', border: 'none',
          color: 'var(--accent-color, #3b82f6)',
          cursor: 'pointer',
        }}
      >
        <ExternalLink size={11} /> View in Notes
      </button>
    </div>
  );
}
