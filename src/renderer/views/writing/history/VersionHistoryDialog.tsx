/**
 * VersionHistoryDialog — Radix Dialog showing version history for a section
 *
 * Layout: timeline on the left, diff view on the right.
 * "恢复此版本" (Restore this version) button reverts section content
 * to the selected historical version via useUpdateSection.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { useDraftVersions, useRestoreDraftVersion } from '../../../core/ipc/hooks/useDrafts';
import { VersionTimeline } from './VersionTimeline';
import { VersionDiff } from './VersionDiff';
import type { SectionVersion } from '../../../../shared-types/models';
import { buildDocumentProjection, parseArticleDocument, serializeArticleDocument } from '../../../../shared/writing/documentOutline';

interface VersionHistoryDialogProps {
  draftId: string;
  sectionId: string;
  currentContent: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistoryDialog({
  draftId,
  sectionId,
  currentContent,
  open,
  onOpenChange,
}: VersionHistoryDialogProps) {
  const { t } = useTranslation();
  const { data: versions } = useDraftVersions(draftId);
  const restoreDraftVersion = useRestoreDraftVersion();

  const sectionVersions: SectionVersion[] = (versions ?? []).map((version) => {
    const projection = buildDocumentProjection(parseArticleDocument(version.documentJson));
    const section = projection.flatSections.find((candidate) => candidate.id === sectionId);
    return {
      sectionId,
      title: section?.title,
      version: version.version,
      content: section?.plainText ?? '',
      documentJson: section ? serializeArticleDocument(section.bodyDocument) : null,
      createdAt: version.createdAt,
      source: version.source === 'duplicate' || version.source === 'ai-derive-draft' ? 'ai-generate' : version.source,
    };
  }).filter((version) => version.content.length > 0 || version.documentJson != null);

  const [selectedVersion, setSelectedVersion] = useState<SectionVersion | null>(
    null,
  );

  const handleRestore = useCallback(() => {
    if (!selectedVersion) return;

    restoreDraftVersion.mutate(
      {
        draftId,
        version: selectedVersion.version,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setSelectedVersion(null);
        },
      },
    );
  }, [draftId, onOpenChange, restoreDraftVersion, selectedVersion]);

  const handleSelectVersion = useCallback((version: SectionVersion) => {
    setSelectedVersion(version);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
            maxWidth: 960,
            height: '80vh',
            backgroundColor: 'var(--color-bg-primary, #fff)',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 51,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--color-border, #e5e7eb)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Dialog.Title style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {t('writing.history.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 20,
                  padding: 4,
                }}
              >
                &times;
              </button>
            </Dialog.Close>
          </div>

          {/* Body: timeline + diff */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left: timeline */}
            <div
              style={{
                width: 260,
                borderRight: '1px solid var(--color-border, #e5e7eb)',
                overflowY: 'auto',
                padding: '12px 0',
              }}
            >
              <VersionTimeline
                versions={sectionVersions}
                selectedVersion={selectedVersion}
                onSelectVersion={handleSelectVersion}
              />
            </div>

            {/* Right: diff view */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {selectedVersion ? (
                <VersionDiff
                  currentContent={currentContent}
                  compareContent={selectedVersion.content}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: 'var(--color-text-secondary, #6b7280)',
                  }}
                >
                  {t('writing.history.selectVersion')}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '12px 24px',
              borderTop: '1px solid var(--color-border, #e5e7eb)',
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
              disabled={!selectedVersion || restoreDraftVersion.isPending}
              onClick={handleRestore}
              style={{
                padding: '6px 16px',
                borderRadius: 4,
                border: 'none',
                background: selectedVersion
                  ? 'var(--color-primary, #2563eb)'
                  : '#d1d5db',
                color: selectedVersion ? '#fff' : '#9ca3af',
                cursor: selectedVersion ? 'pointer' : 'not-allowed',
              }}
            >
              {restoreDraftVersion.isPending ? t('writing.history.restoring') : t('writing.history.restoreVersion')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
