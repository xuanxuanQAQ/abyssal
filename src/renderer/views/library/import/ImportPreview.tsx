/**
 * ImportPreview — 解析预览 + 去重标记（§10.2）
 *
 * 预留组件，供 FileImportTab 在解析后展示结果。
 * TODO: 需要主进程解析 API 返回 ParseResult[]。
 */

import React from 'react';

interface ParsedEntry {
  title: string;
  authors: string;
  year: number;
  isDuplicate: boolean;
}

interface ImportPreviewProps {
  entries: ParsedEntry[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportPreview({ entries, onConfirm, onCancel }: ImportPreviewProps) {
  const nonDuplicate = entries.filter((e) => !e.isDuplicate);
  const duplicateCount = entries.length - nonDuplicate.length;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ maxHeight: 300, overflow: 'auto', marginBottom: 12 }}>
        {entries.map((entry, i) => (
          <div
            key={i}
            style={{
              padding: '6px 8px',
              opacity: entry.isDuplicate ? 0.5 : 1,
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <div style={{ fontWeight: 500 }}>
              {entry.title}
              {entry.isDuplicate && (
                <span style={{ color: 'var(--warning)', marginLeft: 8, fontSize: 'var(--text-xs)' }}>
                  重复
                </span>
              )}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
              {entry.authors} · {entry.year}
            </div>
          </div>
        ))}
      </div>

      {duplicateCount > 0 && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginBottom: 12 }}>
          ⚠ 发现 {duplicateCount} 条重复条目（DOI 匹配），将跳过。
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          onClick={onCancel}
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
          onClick={onConfirm}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--accent-color)',
            color: '#fff',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
          }}
        >
          导入 {nonDuplicate.length} 条
        </button>
      </div>
    </div>
  );
}
