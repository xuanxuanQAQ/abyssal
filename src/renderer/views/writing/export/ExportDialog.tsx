/**
 * ExportDialog — Radix Dialog for export format selection
 *
 * Allows the user to select an export format (Markdown, LaTeX, DOCX, PDF)
 * and triggers the IPC-based export via fs.exportArticle.
 *
 * Displays the article title and provides a simple format selector
 * with an export action button.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { getAPI } from '../../../core/ipc/bridge';
import { handleError } from '../../../core/errors/errorHandlers';
import type { ExportFormat, CitationStyle } from '../../../../shared-types/enums';
import type { ExportProgress } from '../../../../shared-types/models';

interface ExportDialogProps {
  articleId: string;
  draftId?: string | null | undefined;
  articleTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormatOption {
  value: ExportFormat;
  labelKey: string;
  descKey: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { value: 'markdown', labelKey: 'writing.export.formats.markdown', descKey: 'writing.export.formats.markdownDesc' },
  { value: 'latex', labelKey: 'writing.export.formats.latex', descKey: 'writing.export.formats.latexDesc' },
  { value: 'docx', labelKey: 'writing.export.formats.docx', descKey: 'writing.export.formats.docxDesc' },
  { value: 'pdf', labelKey: 'writing.export.formats.pdf', descKey: 'writing.export.formats.pdfDesc' },
];

const CITATION_STYLES: Array<{ value: CitationStyle; label: string }> = [
  { value: 'APA', label: 'APA' },
  { value: 'IEEE', label: 'IEEE' },
  { value: 'GB/T 7714', label: 'GB/T 7714' },
  { value: 'Chicago', label: 'Chicago' },
];

export function ExportDialog({
  articleId,
  draftId,
  articleTitle,
  open,
  onOpenChange,
}: ExportDialogProps) {
  const { t } = useTranslation();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('APA');
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  // Listen for export progress events via preload push channel
  useEffect(() => {
    const api = getAPI() as any;
    const onExportProgress = api.on?.exportProgress;
    if (typeof onExportProgress !== 'function') return;
    const unsubscribe = onExportProgress((data: ExportProgress) => {
      setProgress(data);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportedPath(null);
    setErrorMessage(null);
    setProgress(null);

    try {
      const outputPath = await getAPI().fs.exportArticle(articleId, selectedFormat, citationStyle, draftId ?? undefined);
      setExportedPath(outputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('writing.export.exportFailed');
      setErrorMessage(msg);
      handleError(err);
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }, [articleId, citationStyle, draftId, selectedFormat]);

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
            {t('writing.export.title')}
          </Dialog.Title>

          <Dialog.Description
            style={{
              marginTop: 8,
              fontSize: 14,
              color: 'var(--color-text-secondary, #6b7280)',
            }}
          >
            {t('writing.export.description', { title: articleTitle })}
          </Dialog.Description>

          {/* Format selection */}
          <div
            role="radiogroup"
            aria-label={t('writing.export.formatLabel')}
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
                      {t(option.labelKey)}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary, #6b7280)',
                        marginTop: 2,
                      }}
                    >
                      {t(option.descKey)}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Citation style selector */}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
              {t('writing.export.citationStyle', { defaultValue: '引文格式' })}
            </label>
            <select
              value={citationStyle}
              onChange={(e) => setCitationStyle(e.target.value as CitationStyle)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: 13,
                borderRadius: 4,
                border: '1px solid var(--color-border, #d1d5db)',
                backgroundColor: 'var(--color-bg-primary, #fff)',
                color: 'inherit',
              }}
            >
              {CITATION_STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Export progress */}
          {progress && exporting && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 4 }}>
                {progress.message}
              </div>
              <div style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: 'var(--color-border, #e5e7eb)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${progress.progress}%`,
                  backgroundColor: 'var(--color-primary, #2563eb)',
                  borderRadius: 2,
                  transition: 'width 200ms ease',
                }} />
              </div>
            </div>
          )}

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
              {t('writing.export.exportedTo', { path: exportedPath })}
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
                {t('common.cancel')}
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
              {exporting ? t('writing.export.exporting') : t('writing.export.exportBtn')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
