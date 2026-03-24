/**
 * TextPasteTab — BibTeX 文本粘贴 Tab（§10.1）
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useImportBibtex } from '../../../core/ipc/hooks/usePapers';

interface TextPasteTabProps {
  onClose: () => void;
}

export function TextPasteTab({ onClose }: TextPasteTabProps) {
  const [text, setText] = useState('');
  const importBibtex = useImportBibtex();

  // 简单的 @article/@inproceedings 计数
  const entryCount = (text.match(/@\w+\s*\{/g) || []).length;

  const handleImport = () => {
    if (!text.trim()) return;
    importBibtex.mutate(text, {
      onSuccess: (result) => {
        toast.success(`成功导入 ${result.imported} 篇论文`);
        onClose();
      },
    });
  };

  return (
    <div style={{ padding: 20 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="粘贴 BibTeX 文本…"
        style={{
          width: '100%',
          height: 200,
          padding: 12,
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'monospace',
          resize: 'vertical',
          outline: 'none',
        }}
      />

      {entryCount > 0 && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 8 }}>
          检测到 {entryCount} 个条目
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button
          onClick={onClose}
          style={{
            padding: '6px 16px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          onClick={handleImport}
          disabled={!text.trim() || importBibtex.isPending}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: text.trim() ? 'var(--accent-color)' : 'var(--bg-surface-low)',
            color: text.trim() ? '#fff' : 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            cursor: text.trim() ? 'pointer' : 'default',
          }}
        >
          {importBibtex.isPending ? '导入中…' : '导入'}
        </button>
      </div>
    </div>
  );
}
