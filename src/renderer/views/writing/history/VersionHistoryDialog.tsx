/**
 * VersionHistoryDialog — Radix Dialog showing version history for a section
 *
 * Layout: timeline on the left, diff view on the right.
 * "恢复此版本" (Restore this version) button reverts section content
 * to the selected historical version via useUpdateSection.
 */

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSectionVersions, useUpdateSection } from '../../../core/ipc/hooks/useArticles';
import { VersionTimeline } from './VersionTimeline';
import { VersionDiff } from './VersionDiff';
import type { SectionVersion } from '../../../../shared-types/models';

interface VersionHistoryDialogProps {
  sectionId: string;
  currentContent: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistoryDialog({
  sectionId,
  currentContent,
  open,
  onOpenChange,
}: VersionHistoryDialogProps) {
  const { data: versions } = useSectionVersions(sectionId);
  const updateSection = useUpdateSection();

  const [selectedVersion, setSelectedVersion] = useState<SectionVersion | null>(
    null,
  );

  const handleRestore = useCallback(() => {
    if (!selectedVersion) return;

    updateSection.mutate(
      {
        sectionId,
        patch: { content: selectedVersion.content },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setSelectedVersion(null);
        },
      },
    );
  }, [selectedVersion, sectionId, updateSection, onOpenChange]);

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
              版本历史
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭"
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
                versions={versions ?? []}
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
                  选择一个版本以查看差异
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
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={!selectedVersion || updateSection.isPending}
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
              {updateSection.isPending ? '恢复中...' : '恢复此版本'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
