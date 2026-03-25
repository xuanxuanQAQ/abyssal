/**
 * NoteCard — 结构化笔记卡片（§3.4）
 */

import React from 'react';
import type { NoteMeta } from '../../../../shared-types/models';

interface NoteCardProps {
  note: NoteMeta;
  onClick: () => void;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function NoteCard({ note, onClick }: NoteCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md, 6px)',
        border: '1px solid var(--border-subtle)', padding: 16, cursor: 'pointer',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {note.title}
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {note.linkedPaperIds.slice(0, 3).map((pid) => (
          <span key={pid} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, backgroundColor: '#3B82F612', color: '#3B82F6', border: '1px solid #3B82F630' }}>
            📄 {pid.slice(0, 8)}
          </span>
        ))}
        {note.linkedConceptIds.slice(0, 3).map((cid) => (
          <span key={cid} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, backgroundColor: '#10B98112', color: '#10B981', border: '1px solid #10B98130' }}>
            ◇ {cid.slice(0, 8)}
          </span>
        ))}
        {note.tags.slice(0, 3).map((t) => (
          <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, backgroundColor: '#6B728012', color: '#6B7280', border: '1px solid #6B728030' }}>
            #{t}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{formatRelativeTime(note.updatedAt)}</span>
        <span>{note.wordCount} 字</span>
      </div>
    </div>
  );
}
