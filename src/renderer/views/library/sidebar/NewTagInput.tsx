/**
 * NewTagInput — 内联标签创建输入框（§2.3）
 *
 * Enter 创建，Escape 取消。
 */

import React, { useRef, useEffect, useState } from 'react';
import { useCreateTag } from '../../../core/ipc/hooks/useTags';

interface NewTagInputProps {
  onDone: () => void;
  parentId?: string;
}

export function NewTagInput({ onDone, parentId }: NewTagInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const createTag = useCreateTag();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const name = value.trim();
    if (name) {
      createTag.mutate({ name, ...(parentId !== undefined ? { parentId } : {}) });
    }
    onDone();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <div style={{ padding: '4px 12px 4px 20px' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSubmit}
        placeholder="标签名称…"
        style={{
          width: '100%',
          padding: '3px 6px',
          border: '1px solid var(--accent-color)',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          outline: 'none',
        }}
      />
    </div>
  );
}
