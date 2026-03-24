/**
 * ExportDialog — Radix Dialog for export format selection
 *
 * Allows the user to select an export format (Markdown, LaTeX, DOCX, PDF)
 * and triggers the IPC-based export via fs.exportArticle.
 *
 * Displays the article title and provides a simple format selector
 * with an export action button.
 */

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { getAPI } from '../../../core/ipc/bridge';
import { handleError } from '../../../core/errors/errorHandlers';
import type { ExportFormat } from '../../../../shared-types/enums';

interface ExportDialogProps {
  articleId: string;
  articleTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormatOption {
  value: ExportFormat;
  label: string;
  description: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: 'markdown',
    label: 'Markdown',
    description: '纯文本格式，兼容性好',
  },
  {
    value: 'latex',
    label: 'LaTeX',
    description: '学术排版格式，适合投稿',
  },
  {
    value: 'docx',
    label: 'DOCX',
    description: 'Word 文档格式',
  },
  {
    value: 'pdf',
    label: 'PDF',
    description: '便携文档格式，最终输出',
  },
];

export function ExportDialog({
  articleId,
  articleTitle,
  open,
  onOpenChange,
}: ExportDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportedPath(null);
    setErrorMessage(null);

    try {
      const outputPath = await getAPI().fs.exportArticle(articleId, selectedFormat);
      setExportedPath(outputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导出失败，请重试';
      setErrorMessage(msg);
      handleError(err);
    } finally {
      setExporting(false);
    }
  }, [articleId, selectedFormat]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        // Reset state when closing
        setExportedPath(null);
        setErrorMessage(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 50,
          }}
        />
        <Dialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '90vw',
            maxWidth: 480,
            backgroundColor: 'var(--color-bg-primary, #fff)',
            borderRadius: 8,
            padding: 24,
            zIndex: 51,
          }}
        >
          <Dialog.Title style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            导出文章
          </Dialog.Title>

          <Dialog.Description
            style={{
              marginTop: 8,
              fontSize: 14,
              color: 'var(--color-text-secondary, #6b7280)',
            }}
          >
            将「{articleTitle}」导出为指定格式
          </Dialog.Description>

          {/* Format selection */}
          <div
            role="radiogroup"
            aria-label="导出格式"
            style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {FORMAT_OPTIONS.map((option) => {
              const isSelected = selectedFormat === option.value;
              return (
                <label
                  key={option.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: isSelected
                      ? '2px solid var(--color-primary, #2563eb)'
                      : '1px solid var(--color-border, #d1d5db)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="exportFormat"
                    value={option.value}
                    checked={isSelected}
                    onChange={() => setSelectedFormat(option.value)}
                    style={{ accentColor: 'var(--color-primary, #2563eb)' }}
                  />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>
                      {option.label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary, #6b7280)',
                        marginTop: 2,
                      }}
                    >
                      {option.description}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Export success message */}
          {exportedPath && (
            <div
              style={{
                marginTop: 16,
                padding: '8px 12px',
                borderRadius: 4,
                backgroundColor: 'var(--color-bg-success, #d4edda)',
                color: 'var(--color-text-success, #155724)',
                fontSize: 13,
                wordBreak: 'break-all',
              }}
            >
              已导出至: {exportedPath}
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <div
              style={{
                marginTop: 16,
                padding: '8px 12px',
                backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--danger)',
                fontSize: 12,
              }}
            >
              {errorMessage}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              marginTop: 24,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
            }}
          >
            <Dialog.Close asChild>
              <button
                type="button"
                style={{
                  padding: '6px 16px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #d1d5db)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExport}
              style={{
                padding: '6px 16px',
                borderRadius: 4,
                border: 'none',
                background: 'var(--color-primary, #2563eb)',
                color: '#fff',
                cursor: exporting ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.7 : 1,
              }}
            >
              {exporting ? '导出中...' : '导出'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
