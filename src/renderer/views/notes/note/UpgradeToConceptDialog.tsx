/**
 * UpgradeToConceptDialog — 升级为 Tentative Concept 对话框（§3.5）
 */

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Lightbulb } from 'lucide-react';
import { useCreateConcept } from '../../../core/ipc/hooks/useConcepts';

interface UpgradeToConceptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillNameEn?: string;
  prefillNameZh?: string;
  prefillDefinition?: string;
  prefillKeywords?: string[];
}

export function UpgradeToConceptDialog({
  open, onOpenChange,
  prefillNameEn, prefillNameZh, prefillDefinition, prefillKeywords,
}: UpgradeToConceptDialogProps) {
  const [nameEn, setNameEn] = useState(prefillNameEn ?? '');
  const [nameZh, setNameZh] = useState(prefillNameZh ?? '');
  const [definition, setDefinition] = useState(prefillDefinition ?? '');
  const [keywordsStr, setKeywordsStr] = useState((prefillKeywords ?? []).join(', '));
  const createConcept = useCreateConcept();

  const handleCreate = useCallback(() => {
    if (!nameEn.trim()) return;
    createConcept.mutate(
      {
        nameEn: nameEn.trim(),
        nameZh: nameZh.trim(),
        definition: definition.trim(),
        keywords: keywordsStr.split(',').map((k) => k.trim()).filter(Boolean),
        parentId: null,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  }, [nameEn, nameZh, definition, keywordsStr, createConcept, onOpenChange]);

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
            <Lightbulb size={16} /> 升级为 Tentative 概念
          </Dialog.Title>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="英文名 (name_en)" value={nameEn} onChange={setNameEn} autoFocus />
            <Field label="中文名 (name_zh)" value={nameZh} onChange={setNameZh} />
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>定义</span>
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
            <Field label="关键词 (逗号分隔)" value={keywordsStr} onChange={setKeywordsStr} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Dialog.Close asChild>
              <button style={{ padding: '6px 16px', border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={handleCreate}
              disabled={!nameEn.trim() || createConcept.isPending}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: 4,
                backgroundColor: 'var(--accent-color)', color: '#fff', fontSize: 13,
                cursor: nameEn.trim() ? 'pointer' : 'default', opacity: nameEn.trim() ? 1 : 0.5,
              }}
            >
              {createConcept.isPending ? '创建中...' : '创建概念'}
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
