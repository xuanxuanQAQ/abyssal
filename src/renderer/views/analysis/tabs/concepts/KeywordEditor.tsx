/**
 * KeywordEditor — 关键词 Tag 编辑组件（§2.2）
 */

import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { useUpdateConceptFramework, useConceptFramework } from '../../../../core/ipc/hooks/useConcepts';

interface KeywordEditorProps {
  conceptId: string;
  keywords: string[];
}

export function KeywordEditor({ conceptId, keywords }: KeywordEditorProps) {
  const [inputValue, setInputValue] = useState('');
  // TODO: use dedicated keyword update IPC when available

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || keywords.includes(trimmed)) return;
    // TODO: call db.concepts.updateKeywords
    setInputValue('');
  }, [inputValue, keywords]);

  const handleRemove = useCallback((keyword: string) => {
    // TODO: call db.concepts.updateKeywords
  }, []);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {keywords.map((kw) => (
        <span
          key={kw}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            padding: '2px 8px', borderRadius: 12, fontSize: 12,
            backgroundColor: 'var(--bg-surface-low)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {kw}
          <button
            onClick={() => handleRemove(kw)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        placeholder="添加关键词..."
        style={{
          border: 'none', outline: 'none', fontSize: 12, padding: '2px 4px',
          color: 'var(--text-primary)', backgroundColor: 'transparent', minWidth: 100,
        }}
      />
    </div>
  );
}
