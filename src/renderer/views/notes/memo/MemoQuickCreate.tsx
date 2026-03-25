/**
 * MemoQuickCreate — 碎片笔记快速创建组件（§3.1）
 */

import React, { useState, useCallback, useRef } from 'react';
import { Send } from 'lucide-react';
import { useCreateMemo } from '../../../core/ipc/hooks/useMemos';

interface MemoQuickCreateProps {
  paperIds?: string[];
  conceptIds?: string[];
  annotationId?: string;
  /** 预填文本（如选中的 PDF 文本） */
  prefillText?: string;
}

export function MemoQuickCreate({ paperIds, conceptIds, annotationId, prefillText }: MemoQuickCreateProps) {
  const [text, setText] = useState(prefillText ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createMemo = useCreateMemo();

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const newMemo: import('../../../../shared-types/models').NewMemo = {
      text: trimmed,
      paperIds: paperIds ?? [],
      conceptIds: conceptIds ?? [],
    };
    if (annotationId !== undefined) newMemo.annotationId = annotationId;
    createMemo.mutate(newMemo);
    setText('');
    textareaRef.current?.focus();
  }, [text, paperIds, conceptIds, annotationId, createMemo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      padding: '8px 12px', borderTop: '1px solid var(--border-subtle)',
      backgroundColor: 'var(--bg-surface)', flexShrink: 0,
    }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="记录一个想法... (Enter 提交, Shift+Enter 换行)"
        rows={1}
        style={{
          flex: 1, resize: 'none', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm, 4px)', padding: '6px 10px',
          fontSize: 13, backgroundColor: 'var(--bg-surface-low)',
          color: 'var(--text-primary)', outline: 'none', maxHeight: 72,
          lineHeight: 1.5, fontFamily: 'inherit',
        }}
      />
      <button
        onClick={handleSubmit}
        disabled={!text.trim() || createMemo.isPending}
        style={{
          padding: '6px 10px', border: 'none', borderRadius: 'var(--radius-sm, 4px)',
          backgroundColor: text.trim() ? 'var(--accent-color)' : 'var(--bg-surface-low)',
          color: text.trim() ? '#fff' : 'var(--text-muted)',
          cursor: text.trim() ? 'pointer' : 'default', flexShrink: 0,
        }}
      >
        <Send size={14} />
      </button>
    </div>
  );
}
