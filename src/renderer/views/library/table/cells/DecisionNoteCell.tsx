/**
 * DecisionNoteCell — 截断文本 + 双击内联编辑（§7.3）
 *
 * v1.1 isCanceling 竞态安全。
 */

import React, { useEffect } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useInlineEdit } from '../../hooks/useInlineEdit';
import { useUpdatePaper } from '../../../../core/ipc/hooks/usePapers';

interface DecisionNoteCellProps {
  paperId: string;
  note: string | null;
}

export function DecisionNoteCell({ paperId, note }: DecisionNoteCellProps) {
  const updatePaper = useUpdatePaper();

  const {
    isEditing,
    editValue,
    setEditValue,
    startEdit,
    handleKeyDown,
    handleBlur,
    inputRef,
  } = useInlineEdit({
    initialValue: note ?? '',
    onSave: (value) => {
      updatePaper.mutate({ id: paperId, patch: { decisionNote: value || null } });
    },
  });

  // 自动聚焦
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, inputRef]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          padding: '2px 4px',
          border: '1px solid var(--accent-color)',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          outline: 'none',
        }}
      />
    );
  }

  const displayText = note ?? '';

  if (!displayText) {
    return (
      <span
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit();
        }}
        style={{ width: '100%', height: '100%', cursor: 'text' }}
      />
    );
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEdit();
            }}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 'var(--text-sm)',
              cursor: 'text',
              width: '100%',
            }}
          >
            {displayText}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={4}
            style={{
              padding: '6px 10px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
              maxWidth: 300,
              zIndex: 40,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            {displayText}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
