/**
 * UpgradeToConceptDialog — 升级为 Tentative Concept 对话框（§3.5）
 *
 * Supports two paths:
 * - From memo: pass memoId → uses db:memos:upgradeToConcept
 * - From note: pass noteId → uses db:notes:upgradeToConcept
 * - Standalone: no memoId/noteId → uses db:concepts:create
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Lightbulb } from 'lucide-react';
import { useCreateConcept } from '../../../core/ipc/hooks/useConcepts';
import { useUpgradeMemoToConcept } from '../../../core/ipc/hooks/useMemos';
import { useUpgradeNoteToConcept } from '../../../core/ipc/hooks/useNotes';

interface UpgradeToConceptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillNameEn?: string;
  prefillNameZh?: string;
  prefillDefinition?: string;
  prefillKeywords?: string[];
  /** When upgrading from a memo */
  memoId?: string;
  /** When upgrading from a note */
  noteId?: string;
}

export function UpgradeToConceptDialog({
  open, onOpenChange,
  prefillNameEn, prefillNameZh, prefillDefinition, prefillKeywords,
  memoId, noteId,
}: UpgradeToConceptDialogProps) {
  const { t } = useTranslation();
  const [nameEn, setNameEn] = useState(prefillNameEn ?? '');
  const [nameZh, setNameZh] = useState(prefillNameZh ?? '');
  const [definition, setDefinition] = useState(prefillDefinition ?? '');
  const [keywordsStr, setKeywordsStr] = useState((prefillKeywords ?? []).join(', '));
  const createConcept = useCreateConcept();
  const upgradeMemo = useUpgradeMemoToConcept();
  const upgradeNote = useUpgradeNoteToConcept();

  const isPending = createConcept.isPending || upgradeMemo.isPending || upgradeNote.isPending;

  const handleCreate = useCallback(() => {
    if (!nameEn.trim()) return;
    const draft = {
      nameEn: nameEn.trim(),
      nameZh: nameZh.trim(),
      definition: definition.trim(),
      searchKeywords: keywordsStr.split(',').map((k) => k.trim()).filter(Boolean),
      parentId: null,
    };

    const onSuccess = () => { onOpenChange(false); };

    if (memoId) {
      upgradeMemo.mutate({ memoId, draft }, { onSuccess });
    } else if (noteId) {
      upgradeNote.mutate({ noteId, draft }, { onSuccess });
    } else {
      createConcept.mutate(draft, { onSuccess });
    }
  }, [nameEn, nameZh, definition, keywordsStr, memoId, noteId, createConcept, upgradeMemo, upgradeNote, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 1000 }} />
        <Dialog.Content style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 480, backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md,8px)',
          padding: 24, zIndex: 1001, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}>
          <Dialog.Title style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
            <Lightbulb size={16} /> {t('notes.note.upgradeToConcept')}
          </Dialog.Title>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('notes.note.nameEn')} value={nameEn} onChange={setNameEn} autoFocus />
            <Field label={t('notes.note.nameZh')} value={nameZh} onChange={setNameZh} />
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{t('notes.note.definition')}</span>
              <textarea
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                rows={3}
                maxLength={500}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm,4px)', fontSize: 13, color: 'var(--text-primary)',
                  backgroundColor: 'var(--bg-surface-low)', outline: 'none', resize: 'vertical',
                  lineHeight: 1.5, fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{definition.length}/500</span>
            </label>
            <Field label={t('notes.note.keywords')} value={keywordsStr} onChange={setKeywordsStr} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Dialog.Close asChild>
              <button style={{ padding: '6px 16px', border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
            </Dialog.Close>
            <button
              onClick={handleCreate}
              disabled={!nameEn.trim() || isPending}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: 4,
                backgroundColor: 'var(--accent-color)', color: '#fff', fontSize: 13,
                cursor: nameEn.trim() ? 'pointer' : 'default', opacity: nameEn.trim() ? 1 : 0.5,
              }}
            >
              {isPending ? t('notes.note.creating') : t('notes.note.createConcept')}
            </button>
          </div>

          <Dialog.Close asChild>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
              <X size={16} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</span>
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}
        style={{
          width: '100%', padding: '8px 12px', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm,4px)', fontSize: 13, color: 'var(--text-primary)',
          backgroundColor: 'var(--bg-surface-low)', outline: 'none', boxSizing: 'border-box',
        }}
      />
    </label>
  );
}
