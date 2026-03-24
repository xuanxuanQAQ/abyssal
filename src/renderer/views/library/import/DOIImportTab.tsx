/**
 * DOIImportTab — DOI 导入 Tab（§10.1）
 *
 * 单行 DOI 输入 + 多条添加列表。
 * TODO: 主进程在线查询元数据。
 */

import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface DOIImportTabProps {
  onClose: () => void;
}

export function DOIImportTab({ onClose }: DOIImportTabProps) {
  const [dois, setDois] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [importing, setImporting] = useState(false);

  const addDoi = () => {
    const doi = inputValue.trim();
    if (doi && !dois.includes(doi)) {
      setDois((prev) => [...prev, doi]);
      setInputValue('');
    }
  };

  const removeDoi = (index: number) => {
    setDois((prev) => prev.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    if (dois.length === 0) return;
    setImporting(true);
    // TODO: 调用主进程 DOI 在线查询 + 导入
    toast.error('DOI 导入功能暂未实现');
    setImporting(false);
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDoi();
            }
          }}
          placeholder="输入 DOI (例: 10.1000/xyz123)"
          style={{
            flex: 1,
            padding: '6px 10px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
          }}
        />
        <button
          onClick={addDoi}
          disabled={!inputValue.trim()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-sm)',
            cursor: inputValue.trim() ? 'pointer' : 'default',
          }}
        >
          <Plus size={14} /> 添加
        </button>
      </div>

      {dois.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {dois.map((doi, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                fontSize: 'var(--text-sm)',
              }}
            >
              <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                {doi}
              </span>
              <button
                onClick={() => removeDoi(i)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 2,
                  display: 'flex',
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
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
          disabled={dois.length === 0 || importing}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: dois.length > 0 ? 'var(--accent-color)' : 'var(--bg-surface-low)',
            color: dois.length > 0 ? '#fff' : 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            cursor: dois.length > 0 ? 'pointer' : 'default',
          }}
        >
          {importing ? '导入中…' : `导入 ${dois.length} 个 DOI`}
        </button>
      </div>
    </div>
  );
}
