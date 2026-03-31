/**
 * CreateConceptDialog — 从建议创建概念（§2.3）
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useCreateConcept } from '../../../../core/ipc/hooks/useConcepts';
import { useAcceptSuggestedConcept } from '../../../../core/ipc/hooks/useSuggestedConcepts';

interface CreateConceptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestedId?: string;
  prefillNameEn?: string;
  prefillDefinition?: string;
  prefillKeywords?: string[];
}

export function CreateConceptDialog({
  open, onOpenChange, suggestedId,
  prefillNameEn, prefillDefinition, prefillKeywords,
}: CreateConceptDialogProps) {
  const { t } = useTranslation();
  const [nameEn, setNameEn] = useState(prefillNameEn ?? '');
  const [nameZh, setNameZh] = useState('');
  const [definition, setDefinition] = useState(prefillDefinition ?? '');
  const [keywordsStr, setKeywordsStr] = useState((prefillKeywords ?? []).join(', '));

  const createConcept = useCreateConcept();
  const acceptSuggestion = useAcceptSuggestedConcept();

  const handleCreate = useCallback(() => {
    if (!nameEn.trim()) return;
    const draft = {
      nameEn: nameEn.trim(),
      nameZh: nameZh.trim(),
      definition: definition.trim(),
      keywords: keywordsStr.split(',').map((k) => k.trim()).filter(Boolean),
      parentId: null,
    };

    if (suggestedId) {
      acceptSuggestion.mutate({ suggestedId, draft }, {
        onSuccess: () => onOpenChange(false),
      });
    } else {
      createConcept.mutate(draft, {
        onSuccess: () => onOpenChange(false),
      });
    }
  }, [nameEn, nameZh, definition, keywordsStr, suggestedId, createConcept, acceptSuggestion, onOpenChange]);

  const isPending = createConcept.isPending || acceptSuggestion.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 1000 }} />
        <Dialog.Content style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 480, backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md,8px)',
          padding: 24, zIndex: 1001, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}>
          <Dialog.Title style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
            {t('analysis.concepts.create.title')}
          </Dialog.Title>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <InputField label={t('analysis.concepts.create.nameEn')} value={nameEn} onChange={setNameEn} autoFocus />
            <InputField label={t('analysis.concepts.create.nameZh')} value={nameZh} onChange={setNameZh} />
            <label style={{ display: 'block' }}>
              <span style={labelStyle}>{t('analysis.concepts.create.definition')}</span>
              <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={3} maxLength={500} style={textareaStyle} />
            </label>
            <InputField label={t('analysis.concepts.create.keywordsHint')} value={keywordsStr} onChange={setKeywordsStr} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Dialog.Close asChild>
              <button style={cancelBtnStyle}>{t('common.cancel')}</button>
            </Dialog.Close>
            <button onClick={handleCreate} disabled={!nameEn.trim() || isPending} style={{ ...primaryBtnStyle, opacity: nameEn.trim() ? 1 : 0.5 }}>
              {isPending ? t('analysis.concepts.create.creating') : t('analysis.concepts.create.createTentative')}
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

function InputField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} style={inputStyle} />
    </label>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm,4px)', fontSize: 13, color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-surface-low)', outline: 'none', boxSizing: 'border-box',
};
const textareaStyle: React.CSSProperties = {
  ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 16px', border: '1px solid var(--border-subtle)', borderRadius: 4,
  background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer',
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 16px', border: 'none', borderRadius: 4,
  backgroundColor: 'var(--accent-color)', color: '#fff', fontSize: 13, cursor: 'pointer',
};
