/**
 * FileImportTab — 文件拖入/选择 Tab（§10.1）
 *
 * 拖拽区域 + 文件选择按钮。支持 .bib, .ris, .pdf。
 */

import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAPI } from '../../../core/ipc/bridge';
import { useQueryClient } from '@tanstack/react-query';

interface FileImportTabProps {
  onClose: () => void;
}

export function FileImportTab({ onClose }: FileImportTabProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const validExts = ['.bib', '.ris', '.pdf'];
    const valid = Array.from(newFiles).filter((f) => {
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
      return validExts.includes(ext);
    });
    if (valid.length < newFiles.length) {
      toast.error(t('library.fileImport.unsupportedSkipped'));
    }
    setFiles((prev) => [...prev, ...valid]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleImport = async () => {
    if (files.length === 0) return;
    setImporting(true);
    try {
      // Electron 环境中 File 对象带有 path 属性
      const paths = files.map((f) => (f as File & { path: string }).path);
      const result = await getAPI().fs.importFiles(paths);
      queryClient.invalidateQueries({ queryKey: ['papers'] });
      toast.success(t('library.fileImport.successCount', { count: result.imported }));
      onClose();
    } catch {
      toast.error(t('library.fileImport.failed'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      {/* 拖拽区域 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragOver ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '40px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          backgroundColor: isDragOver ? 'var(--accent-color-10)' : 'transparent',
          transition: 'all 150ms',
        }}
      >
        <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          {t('library.fileImport.dropHint')}
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: 4 }}>
          {t('library.fileImport.supported')}
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".bib,.ris,.pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
        }}
      />

      {/* 已选文件列表 */}
      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 8 }}>
            {t('library.fileImport.selectedFiles')}
          </p>
          {files.map((f, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              📄 {f.name}
            </div>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
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
          disabled={files.length === 0 || importing}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: files.length > 0 ? 'var(--accent-color)' : 'var(--bg-surface-low)',
            color: files.length > 0 ? '#fff' : 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            cursor: files.length > 0 ? 'pointer' : 'default',
          }}
        >
          {importing ? t('library.fileImport.importing') : t('library.fileImport.importCount', { count: files.length })}
        </button>
      </div>
    </div>
  );
}
