/**
 * ImportPreview — 解析预览 + 去重标记（§10.2）
 *
 * 供 FileImportTab 在解析后展示结果。
 * 接受 ParsedEntry[] 数据，显示去重标记并确认导入。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
                  {t('library.importPreview.duplicate')}
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
          {t('library.importPreview.duplicateWarning', { count: duplicateCount })}
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
          {t('common.cancel')}
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
          {t('library.importPreview.importCount', { count: nonDuplicate.length })}
        </button>
      </div>
    </div>
  );
}
