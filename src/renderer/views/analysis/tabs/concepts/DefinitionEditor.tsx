/**
 * DefinitionEditor — 概念定义编辑器（§2.2, §2.5）
 *
 * 纯文本 textarea，≤500 字符限制。
 * 保存时调用 updateDefinition，进行中时 textarea disabled。
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useUpdateDefinition } from '../../../../core/ipc/hooks/useConcepts';

interface DefinitionEditorProps {
  conceptId: string;
  initialValue: string;
}

export function DefinitionEditor({ conceptId, initialValue }: DefinitionEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const updateDef = useUpdateDefinition();
  const isPending = updateDef.isPending;

  useEffect(() => {
    setValue(initialValue);
    setSavedValue(initialValue);
  }, [conceptId, initialValue]);

  const handleSave = useCallback(() => {
    if (value.trim() === savedValue.trim() || isPending) return;
    updateDef.mutate(
      { conceptId, newDefinition: value.trim() },
      {
        onSuccess: (result) => {
          setSavedValue(value.trim());
          // TODO: show impact estimation dialog based on result.changeType and result.affectedMappings
        },
        onError: () => {
          // Rollback on error
          setValue(savedValue);
        },
      },
    );
  }, [value, savedValue, conceptId, isPending, updateDef]);

  return (
    <div style={{ position: 'relative' }}>
      {isPending && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '4px 10px', backgroundColor: '#FEF3C7', color: '#92400E',
          fontSize: 11, borderRadius: '4px 4px 0 0', zIndex: 1,
        }}>
          正在分析变更影响...
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => { if (e.target.value.length <= 500) setValue(e.target.value); }}
        onBlur={handleSave}
        onKeyDown={(e) => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); } }}
        disabled={isPending}
        rows={4}
        style={{
          width: '100%', padding: '8px 10px', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm, 4px)', fontSize: 13, lineHeight: 1.5,
          color: 'var(--text-primary)', backgroundColor: isPending ? 'var(--bg-surface-low)' : 'var(--bg-surface)',
          opacity: isPending ? 0.7 : 1, outline: 'none', resize: 'vertical', fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
        {value.length}/500
      </div>
    </div>
  );
}
