/**
 * ImportDialog — 导入 Dialog 容器（§10）
 *
 * Radix Dialog + Radix Tabs（文件导入 / 文本粘贴 / DOI 导入）。
 */

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { FileImportTab } from './FileImportTab';
import { TextPasteTab } from './TextPasteTab';
import { DOIImportTab } from './DOIImportTab';
import { Z_INDEX } from '../../../styles/zIndex';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab: 'file' | 'text' | 'doi';
}

export function ImportDialog({ open, onOpenChange, defaultTab }: ImportDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--overlay-bg)',
            zIndex: Z_INDEX.MODAL_BACKDROP,
          }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 520,
            maxHeight: '80vh',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: Z_INDEX.MODAL,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px 12px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <Dialog.Title style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
              导入文献
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 4,
                  display: 'flex',
                }}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Tabs */}
          <Tabs.Root defaultValue={defaultTab} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Tabs.List
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--border-subtle)',
                padding: '0 20px',
              }}
            >
              <Tabs.Trigger value="file" style={tabTriggerStyle}>
                文件导入
              </Tabs.Trigger>
              <Tabs.Trigger value="text" style={tabTriggerStyle}>
                文本粘贴
              </Tabs.Trigger>
              <Tabs.Trigger value="doi" style={tabTriggerStyle}>
                DOI 导入
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="file" style={{ flex: 1, overflow: 'auto' }}>
              <FileImportTab onClose={() => onOpenChange(false)} />
            </Tabs.Content>
            <Tabs.Content value="text" style={{ flex: 1, overflow: 'auto' }}>
              <TextPasteTab onClose={() => onOpenChange(false)} />
            </Tabs.Content>
            <Tabs.Content value="doi" style={{ flex: 1, overflow: 'auto' }}>
              <DOIImportTab onClose={() => onOpenChange(false)} />
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const tabTriggerStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
};
