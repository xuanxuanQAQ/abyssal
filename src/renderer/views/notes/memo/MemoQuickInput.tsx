/**
 * MemoQuickInput — 全局碎片笔记快速输入浮层（§3.1）
 *
 * Cmd+Shift+N 触发，上下文感知预填。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Send, X } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import { useCreateMemo } from '../../../core/ipc/hooks/useMemos';

export function MemoQuickInput() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.memoQuickInputOpen);
  const setOpen = useAppStore((s) => s.setMemoQuickInputOpen);
  const activeView = useAppStore((s) => s.activeView);
  const selectedPaperId = useAppStore((s) => s.selectedPaperId);
  const selectedConceptId = useAppStore((s) => s.selectedConceptId);
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);

  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createMemo = useCreateMemo();

  // Auto-derive associations from current view context
  const paperIds: string[] = selectedPaperId && ['reader', 'library'].includes(activeView) ? [selectedPaperId] : [];
  const conceptIds: string[] = selectedConceptId && activeView === 'analysis' ? [selectedConceptId] : [];

  useEffect(() => {
    if (open) {
      setText('');
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const newMemo: import('../../../../shared-types/models').NewMemo = {
      text: trimmed,
      paperIds,
      conceptIds,
    };
    if (selectedSectionId != null) newMemo.outlineId = selectedSectionId;
    createMemo.mutate(newMemo);
    setOpen(false);
  }, [text, paperIds, conceptIds, selectedSectionId, createMemo, setOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 1100,
        }} />
        <Dialog.Content
          onKeyDown={handleKeyDown}
          style={{
            position: 'fixed', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 520, backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md, 8px)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)', zIndex: 1101, padding: 20,
          }}
        >
          <Dialog.Title style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
            {t('notes.memo.quickNote')}
          </Dialog.Title>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('notes.memo.recordThought')}
            rows={4}
            style={{
              width: '100%', resize: 'vertical', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm, 4px)', padding: '8px 12px', fontSize: 13,
              backgroundColor: 'var(--bg-surface-low)', color: 'var(--text-primary)',
              outline: 'none', lineHeight: 1.5, fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />

          {/* Auto-association indicators */}
          {(paperIds.length > 0 || conceptIds.length > 0) && (
            <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
              {paperIds.map((pid) => (
                <span key={pid} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--bg-surface-low)', color: 'var(--text-secondary)' }}>
                  📄 {pid.slice(0, 8)}
                </span>
              ))}
              {conceptIds.map((cid) => (
                <span key={cid} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--bg-surface-low)', color: 'var(--text-secondary)' }}>
                  ◇ {cid.slice(0, 8)}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <Dialog.Close asChild>
              <button style={{ padding: '6px 14px', border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
            </Dialog.Close>
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || createMemo.isPending}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: 4,
                backgroundColor: 'var(--accent-color)', color: '#fff', fontSize: 12,
                cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : 0.5,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Send size={12} /> {t('notes.memo.submitHint')}
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
