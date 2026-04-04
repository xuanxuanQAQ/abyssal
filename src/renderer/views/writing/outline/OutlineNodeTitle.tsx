/**
 * OutlineNodeTitle -- inline edit component for react-arborist rename mode
 *
 * Rendered when `node.isEditing` is true.
 * - Auto-focused + select-all on mount
 * - Enter / blur -> save title via draft-scoped section mutation
 * - Escape       -> cancel (node.reset)
 */

import React, { useRef, useEffect, useState } from 'react';
import type { NodeApi } from 'react-arborist';
import { useUpdateDraftSection } from '../../../core/ipc/hooks/useDrafts';
import type { TreeNodeData } from './useOutlineTree';

interface OutlineNodeTitleProps {
  node: NodeApi<TreeNodeData>;
  draftId: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '2px 4px',
  fontSize: 'var(--text-sm)',
  border: '1px solid var(--accent-color)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
};

export function OutlineNodeTitle({ node, draftId }: OutlineNodeTitleProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(node.data.name);
  const updateSection = useUpdateDraftSection();

  // Track whether we already submitted, to avoid double-save on blur after Enter
  const submittedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const save = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;

    const trimmed = title.trim();
    if (trimmed && trimmed !== node.data.name) {
      updateSection.mutate({ draftId, sectionId: node.id, patch: { title: trimmed } });
    }
    node.reset();
  };

  const cancel = () => {
    submittedRef.current = true;
    node.reset();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const handleBlur = () => {
    save();
  };

  return (
    <input
      ref={inputRef}
      style={inputStyle}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    />
  );
}
