/**
 * WebURLImportTab — 网页 URL 导入 Tab
 *
 * 输入 URL → 调用 web:import → 抓取并导入为网页文章类型的 paper。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAPI } from '../../../core/ipc/bridge';

interface WebURLImportTabProps {
  onClose: () => void;
}

export function WebURLImportTab({ onClose }: WebURLImportTabProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);

  const isValidUrl = (s: string) => {
    try {
      const parsed = new URL(s);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      toast.error(t('library.webImport.invalidUrl'));
      return;
    }

    setImporting(true);
    try {
      const result = await getAPI().web.import(trimmed);
      toast.success(t('library.webImport.success', { title: result.title }));
      setUrl('');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('library.webImport.failed', { message }));
    } finally {
      setImporting(false);
    }
  };

  const canImport = isValidUrl(url.trim()) && !importing;

  return (
    <div style={{ padding: 20 }}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 16 }}>
        {t('library.webImport.description')}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            padding: '0 10px',
          }}
        >
          <Globe size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              // 阻止 Ctrl+A/C/V/X 等编辑快捷键被 Electron 全局快捷键拦截
              if (e.ctrlKey || e.metaKey) {
                e.stopPropagation();
              }
              if (e.key === 'Enter' && canImport) {
                e.preventDefault();
                handleImport();
              }
            }}
            placeholder={t('library.webImport.placeholder')}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {importing && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          {t('library.webImport.fetching')}
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
          {t('common.cancel')}
        </button>
        <button
          onClick={handleImport}
          disabled={!canImport}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: canImport ? 'var(--accent-color)' : 'var(--bg-surface-low)',
            color: canImport ? '#fff' : 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            cursor: canImport ? 'pointer' : 'default',
          }}
        >
          {t('library.webImport.importButton')}
        </button>
      </div>
    </div>
  );
}
