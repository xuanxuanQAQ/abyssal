/**
 * MemoCard — 碎片笔记卡片（§3.2）
 *
 * Redesigned: always-visible actions, better visual hierarchy,
 * expandable text, inline delete confirmation.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, FileUp, Lightbulb, Check, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Memo } from '../../../../shared-types/models';
import { useDeleteMemo, useUpdateMemo, useUpgradeMemoToNote } from '../../../core/ipc/hooks/useMemos';
import { UpgradeToConceptDialog } from '../note/UpgradeToConceptDialog';
import { useAppStore } from '../../../core/store';
import { cancelPendingContextReveal, previewContextSource } from '../../../panels/context/engine/revealContextSource';
import type { EntityDisplayNameCache } from '../shared/entityDisplayNameCache';

interface MemoCardProps {
  memo: Memo;
  entityNameCache: EntityDisplayNameCache;
}

function formatRelativeTime(isoDate: string, t: TFunction): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('notes.memo.justNow');
  if (mins < 60) return t('notes.memo.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('notes.memo.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('notes.memo.daysAgo', { count: days });
}

export function MemoCard({ memo, entityNameCache }: MemoCardProps) {
  const { t } = useTranslation();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const selectMemo = useAppStore((s) => s.selectMemo);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(memo.text);
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [secondaryActionsOpen, setSecondaryActionsOpen] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [textOverflows, setTextOverflows] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const deleteMutation = useDeleteMemo();
  const updateMutation = useUpdateMemo();
  const upgradeToNoteMutation = useUpgradeMemoToNote();

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editing]);

  // Detect text overflow for expand/collapse toggle
  useEffect(() => {
    if (textRef.current && !editing) {
      setTextOverflows(textRef.current.scrollHeight > textRef.current.clientHeight + 2);
    }
  }, [memo.text, editing, expanded]);

  const handleDelete = () => {
    deleteMutation.mutate(memo.id);
    setConfirmingDelete(false);
  };

  const handleEditSave = () => {
    if (editText.trim() && editText !== memo.text) {
      updateMutation.mutate({ memoId: memo.id, patch: { text: editText } });
    }
    setEditing(false);
  };

  const handleEditCancel = () => {
    setEditText(memo.text);
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleEditSave();
    }
    if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const isDeleting = deleteMutation.isPending;
  const hasTags = memo.paperIds.length > 0 || memo.conceptIds.length > 0 || memo.tags.length > 0;

  return (
    <>
      <div
        onClick={() => selectMemo(memo.id)}
        style={{
          padding: '12px 14px', marginBottom: 8,
          backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md, 6px)',
          border: '1px solid var(--border-subtle)',
          borderLeft: `3px solid ${memo.conceptIds.length > 0 ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
          opacity: isDeleting ? 0.4 : 1,
          pointerEvents: isDeleting ? 'none' : 'auto',
          transition: 'opacity 0.2s, box-shadow 0.15s',
        }}
        onMouseEnter={() => previewContextSource({ type: 'memo', memoId: memo.id })}
        onMouseLeave={cancelPendingContextReveal}
      >
        {/* ── Text or edit area ── */}
        {editing ? (
          <div>
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              style={{
                width: '100%', minHeight: 72, padding: 8, border: '1px solid var(--accent-color)',
                borderRadius: 4, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
                backgroundColor: 'var(--bg-surface-low)', outline: 'none', resize: 'vertical',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleEditCancel} style={secondaryBtnStyle}>
                {t('common.cancel')}
              </button>
              <button onClick={handleEditSave} style={primaryBtnStyle}>
                {t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div
              ref={textRef}
              style={{
                fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                ...(expanded ? {} : {
                  display: '-webkit-box', WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }),
              }}
            >
              {memo.text}
            </div>
            {textOverflows && !expanded && (
              <button
                onClick={() => setExpanded(true)}
                style={expandBtnStyle}
              >
                <ChevronDown size={12} /> {t('common.showMore', '展开')}
              </button>
            )}
            {expanded && (
              <button
                onClick={() => setExpanded(false)}
                style={expandBtnStyle}
              >
                <ChevronUp size={12} /> {t('common.showLess', '收起')}
              </button>
            )}
          </div>
        )}

        {/* ── Tags row ── */}
        {hasTags && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {memo.paperIds.map((pid) => (
              <span key={pid} style={tagStyle('var(--color-paper-tag, #3B82F6)')}>
                {entityNameCache.getPaperName(pid)}
              </span>
            ))}
            {memo.conceptIds.map((cid) => (
              <span key={cid} style={tagStyle('var(--color-concept-tag, #10B981)')}>
                {entityNameCache.getConceptName(cid)}
              </span>
            ))}
            {memo.tags.map((tag) => (
              <span key={tag} style={tagStyle('var(--text-muted, #6B7280)')}>
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* ── Linked note indicator ── */}
        {memo.linkedNoteIds.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent-color)' }}>
            {t('notes.memo.expandedToNote')}
          </div>
        )}

        {/* ── Footer: timestamp + actions (always visible) ── */}
        {!editing && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 10, paddingTop: 8,
            borderTop: '1px solid var(--border-subtle)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {isDeleting
                ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                : formatRelativeTime(memo.createdAt, t)
              }
            </span>

            {/* ── Actions ── */}
            {confirmingDelete ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--color-danger, #EF4444)' }}>
                  {t('notes.memo.confirmDelete', '确认删除？')}
                </span>
                <IconBtn
                  icon={<Check size={14} />}
                  title={t('common.confirm', '确认')}
                  onClick={handleDelete}
                  danger
                />
                <IconBtn
                  icon={<X size={14} />}
                  title={t('common.cancel')}
                  onClick={() => setConfirmingDelete(false)}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconBtn
                  icon={<Pencil size={14} />}
                  title={t('common.edit')}
                  onClick={() => { setEditText(memo.text); setEditing(true); }}
                />
                <IconBtn
                  icon={<Trash2 size={14} />}
                  title={t('common.delete')}
                  onClick={() => setConfirmingDelete(true)}
                />
                <div style={{ width: 1, height: 14, backgroundColor: 'var(--border-subtle)', margin: '0 2px' }} />
                <IconBtn
                  icon={<FileUp size={14} />}
                  title={t('notes.memo.expandToNote')}
                  onClick={() => upgradeToNoteMutation.mutate(memo.id, {
                    onSuccess: (result) => navigateTo({ type: 'note', noteId: result.noteId }),
                  })}
                  disabled={upgradeToNoteMutation.isPending}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSecondaryActionsOpen((open) => !open);
                  }}
                  style={secondaryActionToggleStyle}
                >
                  <span>{t('common.moreActions')}</span>
                  {secondaryActionsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </div>
            )}
          </div>
        )}

        {!editing && !confirmingDelete && secondaryActionsOpen && (
          <div style={secondaryActionsPanelStyle}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSecondaryActionsOpen(false);
                setShowUpgradeDialog(true);
              }}
              style={secondaryActionBtnStyle}
            >
              <Lightbulb size={13} />
              <span>{t('notes.memo.upgradeToConcept')}</span>
            </button>
          </div>
        )}
      </div>

      <UpgradeToConceptDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        prefillDefinition={memo.text.slice(0, 500)}
        memoId={memo.id}
      />
    </>
  );
}

/* ── Icon-only action button ── */

function IconBtn({ icon, title, onClick, disabled, danger }: {
  icon: React.ReactNode; title: string; onClick: () => void;
  disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, padding: 0,
        border: 'none', borderRadius: 'var(--radius-sm, 4px)',
        backgroundColor: 'transparent',
        color: danger ? 'var(--color-danger, #EF4444)' : 'var(--text-muted)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background-color 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = 'var(--bg-surface-high, rgba(0,0,0,0.06))';
          e.currentTarget.style.color = danger ? 'var(--color-danger, #EF4444)' : 'var(--text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.color = danger ? 'var(--color-danger, #EF4444)' : 'var(--text-muted)';
      }}
    >
      {icon}
    </button>
  );
}

/* ── Styles ── */

const primaryBtnStyle: React.CSSProperties = {
  padding: '4px 14px', border: 'none', borderRadius: 4,
  backgroundColor: 'var(--accent-color)', color: '#fff',
  fontSize: 12, cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '4px 14px', border: '1px solid var(--border-subtle)', borderRadius: 4,
  backgroundColor: 'transparent', color: 'var(--text-secondary)',
  fontSize: 12, cursor: 'pointer',
};

const expandBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  marginTop: 4, padding: 0, border: 'none', background: 'none',
  color: 'var(--accent-color)', fontSize: 11, cursor: 'pointer',
};

const secondaryActionToggleStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  height: 28, padding: '0 8px',
  border: 'none', borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent', color: 'var(--text-muted)',
  cursor: 'pointer', fontSize: 11,
};

const secondaryActionsPanelStyle: React.CSSProperties = {
  marginTop: 8,
  paddingTop: 8,
  borderTop: '1px dashed var(--border-subtle)',
};

const secondaryActionBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 10px',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent', color: 'var(--text-secondary)',
  fontSize: 12, cursor: 'pointer',
};

function tagStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 11, color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
    lineHeight: '16px',
  };
}
