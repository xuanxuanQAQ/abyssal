/**
 * NoteCard  研究笔记卡片
 *
 * 标题、标签、时间、字数。点击进入编辑器。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Check, X, Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { NoteMeta } from '../../../../shared-types/models';
import { useDeleteNote } from '../../../core/ipc/hooks/useNotes';
import { cancelPendingContextReveal, previewContextSource } from '../../../panels/context/engine/revealContextSource';
import type { EntityDisplayNameCache } from '../shared/entityDisplayNameCache';

interface NoteCardProps {
  note: NoteMeta;
  onClick: () => void;
  entityNameCache: EntityDisplayNameCache;
}

function formatRelativeTime(isoDate: string, t: TFunction): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('common.daysAgo', { count: days });
}

export function NoteCard({ note, onClick, entityNameCache }: NoteCardProps) {
  const { t } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteMutation = useDeleteNote();
  const isDeleting = deleteMutation.isPending;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteMutation.mutate(note.id);
    setConfirmingDelete(false);
  };

  return (
    <div
      onClick={isDeleting ? undefined : onClick}
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        padding: '10px 12px',
        cursor: isDeleting ? 'default' : 'pointer',
        opacity: isDeleting ? 0.4 : 1,
        transition: 'box-shadow 0.15s, opacity 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
      onMouseEnter={(e) => {
        previewContextSource({ type: 'note', noteId: note.id });
        if (!isDeleting) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        cancelPendingContextReveal();
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Title */}
      <div style={{
        fontWeight: 600, fontSize: 13, color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {note.title}
      </div>

      {/* Tags */}
      {(note.linkedPaperIds.length > 0 || note.linkedConceptIds.length > 0 || note.tags.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {note.linkedPaperIds.slice(0, 2).map((pid) => (
            <span key={pid} style={tagStyle('#3B82F6')}>
              {entityNameCache.getPaperName(pid)}
            </span>
          ))}
          {note.linkedConceptIds.slice(0, 2).map((cid) => (
            <span key={cid} style={tagStyle('#10B981')}>
              {entityNameCache.getConceptName(cid)}
            </span>
          ))}
          {note.tags.slice(0, 2).map((tag) => (
            <span key={tag} style={tagStyle('var(--text-muted, #6B7280)')}>
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, color: 'var(--text-muted)',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span>{formatRelativeTime(note.updatedAt, t)}</span>
          <span>{t('notes.note.charCount', { count: note.wordCount })}</span>
        </div>

        {confirmingDelete ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            <span style={{ fontSize: 11, color: 'var(--color-danger, #EF4444)' }}>
              {t('notes.memo.confirmDelete', '删除？')}
            </span>
            <IconBtn icon={<Check size={13} />} title={t('common.confirm', '确认')} onClick={handleDelete} danger />
            <IconBtn icon={<X size={13} />} title={t('common.cancel')} onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false); }} />
          </div>
        ) : (
          <div onClick={(e) => e.stopPropagation()}>
            {isDeleting
              ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
              : <IconBtn icon={<Trash2 size={13} />} title={t('common.delete')} onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }} />
            }
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({ icon, title, onClick, danger }: {
  icon: React.ReactNode; title: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title} onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, padding: 0,
        border: 'none', borderRadius: 4,
        backgroundColor: 'transparent',
        color: danger ? 'var(--color-danger, #EF4444)' : 'var(--text-muted)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-high, rgba(0,0,0,0.06))'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {icon}
    </button>
  );
}

function tagStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block', padding: '1px 6px', borderRadius: 10,
    fontSize: 10, color, lineHeight: '16px',
    backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
  };
}