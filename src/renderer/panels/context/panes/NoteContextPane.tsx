/**
 * NoteContextPane — Graph 视图中点击 memo/note 节点时的面板（§7.3）
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { StickyNote, FileText, ExternalLink } from 'lucide-react';
import { useMemo as useMemoHook } from '../../../core/ipc/hooks/useMemos';
import { useNote } from '../../../core/ipc/hooks/useNotes';
import { useUpgradeMemoToNote } from '../../../core/ipc/hooks/useMemos';
import { useAppStore } from '../../../core/store';
import { useEntityDisplayNameCache } from '../../../views/notes/shared/entityDisplayNameCache';

interface NoteContextPaneProps {
  nodeId: string;
  nodeType: 'memo' | 'note';
}

export const NoteContextPane = React.memo(function NoteContextPane({ nodeId, nodeType }: NoteContextPaneProps) {
  const { t } = useTranslation();
  const { data: memo, isLoading: memoLoading } = useMemoHook(nodeType === 'memo' ? nodeId : null);
  const { data: note, isLoading: noteLoading } = useNote(nodeType === 'note' ? nodeId : null);
  const displayNames = useEntityDisplayNameCache();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const upgradeMemoToNote = useUpgradeMemoToNote();

  const isLoading = nodeType === 'memo' ? memoLoading : noteLoading;

  const handleOpen = () => {
    if (nodeType === 'memo') {
      navigateTo({ type: 'memo', memoId: nodeId });
      return;
    }
    navigateTo({ type: 'note', noteId: nodeId });
  };

  if (isLoading) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        {nodeType === 'memo' ? <StickyNote size={16} /> : <FileText size={16} />}
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {nodeType === 'memo' ? t('notes.memo.title') : (note?.title ?? t('notes.note.untitled'))}
        </span>
      </div>

      {/* Memo content */}
      {nodeType === 'memo' && memo && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 12 }}>
            {memo.text}
          </div>

          {/* Linked entities */}
          {memo.paperIds.length > 0 && (
            <EntitySection
              label={t('notes.memo.linkedPapers')}
              ids={memo.paperIds}
              color="#3B82F6"
              resolveLabel={(id, index) => {
                const resolved = displayNames.getPaperName(id);
                return resolved === id || resolved === id.slice(0, 10)
                  ? `${t('context.header.paper')} ${index + 1}`
                  : resolved;
              }}
            />
          )}
          {memo.conceptIds.length > 0 && (
            <EntitySection
              label={t('notes.memo.linkedConcepts')}
              ids={memo.conceptIds}
              color="#10B981"
              resolveLabel={(id, index) => {
                const resolved = displayNames.getConceptName(id);
                return resolved === id || resolved === id.slice(0, 10)
                  ? `${t('context.header.concept')} ${index + 1}`
                  : resolved;
              }}
            />
          )}
          {memo.tags.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                {t('notes.memo.tags')}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {memo.tags.map((tag) => (
                  <span key={tag} style={{
                    fontSize: 11, padding: '1px 6px', borderRadius: 8,
                    backgroundColor: 'var(--bg-surface-low)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}>
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            {new Date(memo.createdAt).toLocaleString()}
          </div>
        </div>
      )}

      {/* Note content */}
      {nodeType === 'note' && note && (
        <div>
          {/* Preview of note content */}
          {note.documentJson ? (
            <div style={{
              fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
              maxHeight: 200, overflow: 'auto', marginBottom: 12,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {extractPreviewText(note.documentJson, 1000)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('notes.note.empty')}
            </div>
          )}

          {/* Linked entities */}
          {note.linkedPaperIds.length > 0 && (
            <EntitySection
              label={t('notes.note.linkedPapers')}
              ids={note.linkedPaperIds}
              color="#3B82F6"
              resolveLabel={(id, index) => {
                const resolved = displayNames.getPaperName(id);
                return resolved === id || resolved === id.slice(0, 10)
                  ? `${t('context.header.paper')} ${index + 1}`
                  : resolved;
              }}
            />
          )}
          {note.linkedConceptIds.length > 0 && (
            <EntitySection
              label={t('notes.note.linkedConcepts')}
              ids={note.linkedConceptIds}
              color="#10B981"
              resolveLabel={(id, index) => {
                const resolved = displayNames.getConceptName(id);
                return resolved === id || resolved === id.slice(0, 10)
                  ? `${t('context.header.concept')} ${index + 1}`
                  : resolved;
              }}
            />
          )}

          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            {new Date(note.updatedAt).toLocaleString()}
          </div>
        </div>
      )}

      {/* Fallback if data not found */}
      {!memo && nodeType === 'memo' && !isLoading && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('notes.memo.notFound')}
        </div>
      )}
      {!note && nodeType === 'note' && !isLoading && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('notes.note.notFound')}
        </div>
      )}

      {((nodeType === 'memo' && memo) || (nodeType === 'note' && note)) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={handleOpen} style={actionButtonStyle(false)}>
            <ExternalLink size={13} /> {t('context.openInNotes', '打开完整笔记')}
          </button>
          {nodeType === 'memo' && memo && (
            <button
              onClick={() => upgradeMemoToNote.mutate(nodeId, {
                onSuccess: (result) => navigateTo({ type: 'note', noteId: result.noteId }),
              })}
              disabled={upgradeMemoToNote.isPending}
              style={actionButtonStyle(upgradeMemoToNote.isPending)}
            >
              {t('notes.memo.expandToNote')}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** Extract plain text preview from ProseMirror JSON */
function extractPlainText(docJson: string): string {
  try {
    const doc = JSON.parse(docJson);
    const parts: string[] = [];
    function walk(node: Record<string, unknown>) {
      if (node.text) parts.push(node.text as string);
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child as Record<string, unknown>);
      }
    }
    walk(doc);
    return parts.join(' ');
  } catch { return ''; }
}

function extractPreviewText(docJson: string, maxLen: number): string {
  const full = extractPlainText(docJson);
  return full.length > maxLen ? full.slice(0, maxLen) + '...' : full;
}

function EntitySection({
  label,
  ids,
  color,
  resolveLabel,
}: {
  label: string;
  ids: string[];
  color: string;
  resolveLabel: (id: string, index: number) => string;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ids.map((id, index) => (
          <span key={id} style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 10,
            fontSize: 10, color, backgroundColor: `${color}12`, border: `1px solid ${color}30`,
          }}>
            {resolveLabel(id, index)}
          </span>
        ))}
      </div>
    </div>
  );
}

function actionButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--border-subtle)',
    background: disabled ? 'var(--bg-surface-low)' : 'transparent',
    color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12,
  };
}
