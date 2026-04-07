/**
 * ImportDialog — 导入 Dialog 容器
 *
 * Radix Dialog + 自定义 Tab（滑动指示器 + 内容淡入）。
 */

import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { FileImportTab } from './FileImportTab';
import { TextPasteTab } from './TextPasteTab';
import { DOIImportTab } from './DOIImportTab';
import { WebURLImportTab } from './WebURLImportTab';
import { Z_INDEX } from '../../../styles/zIndex';

type TabKey = 'file' | 'text' | 'doi' | 'web';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab: TabKey;
}

const TABS: TabKey[] = ['file', 'text', 'doi', 'web'];

export function ImportDialog({ open, onOpenChange, defaultTab }: ImportDialogProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const [contentKey, setContentKey] = useState(0); // forces fade-in re-trigger

  // 每次打开时同步到调用方指定的 tab
  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  // ── 滑动指示器 ──
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<TabKey, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [indicatorReady, setIndicatorReady] = useState(false);

  const measureIndicator = useCallback(() => {
    const el = tabRefs.current.get(activeTab);
    const list = tabListRef.current;
    if (el && list) {
      const listRect = list.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setIndicator({
        left: elRect.left - listRect.left,
        width: elRect.width,
      });
      setIndicatorReady(true);
    }
  }, [activeTab]);

  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator]);

  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setContentKey((k) => k + 1);
  };

  const handleClose = () => onOpenChange(false);

  const tabLabels: Record<TabKey, string> = {
    file: t('library.import.tabs.file'),
    text: t('library.import.tabs.text'),
    doi: t('library.import.tabs.doi'),
    web: t('library.import.tabs.web'),
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--overlay-bg)',
            zIndex: Z_INDEX.MODAL_BACKDROP,
            animation: 'fadeIn 150ms ease',
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
            animation: 'dialogIn 200ms ease',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px 12px',
            }}
          >
            <Dialog.Title style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
              {t('library.import.title')}
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
                  borderRadius: 'var(--radius-sm)',
                  transition: 'color 150ms, background 150ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-primary)';
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-muted)';
                  e.currentTarget.style.background = 'none';
                }}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Tab bar with sliding indicator */}
          <div
            ref={tabListRef}
            role="tablist"
            style={{
              position: 'relative',
              display: 'flex',
              padding: '0 20px',
              gap: 0,
            }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  ref={(el) => { if (el) tabRefs.current.set(tab, el); }}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleTabChange(tab)}
                  style={{
                    padding: '10px 18px',
                    border: 'none',
                    background: 'none',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: isActive ? 500 : 400,
                    cursor: 'pointer',
                    transition: 'color 200ms ease',
                    position: 'relative',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tabLabels[tab]}
                </button>
              );
            })}

            {/* Bottom border */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 1,
                backgroundColor: 'var(--border-subtle)',
              }}
            />

            {/* Sliding indicator */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: indicator.left,
                width: indicator.width,
                height: 2,
                backgroundColor: 'var(--accent-color, #3b82f6)',
                borderRadius: 1,
                transition: indicatorReady ? 'left 250ms cubic-bezier(.4,0,.2,1), width 250ms cubic-bezier(.4,0,.2,1)' : 'none',
              }}
            />
          </div>

          {/* Tab content with fade-in */}
          <div
            key={contentKey}
            style={{
              flex: 1,
              overflow: 'auto',
              animation: 'tabFadeIn 200ms ease',
            }}
          >
            {activeTab === 'file' && <FileImportTab onClose={handleClose} />}
            {activeTab === 'text' && <TextPasteTab onClose={handleClose} />}
            {activeTab === 'doi' && <DOIImportTab onClose={handleClose} />}
            {activeTab === 'web' && <WebURLImportTab onClose={handleClose} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Keyframe animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0 }
          to { opacity: 1 }
        }
        @keyframes dialogIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.97) }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1) }
        }
        @keyframes tabFadeIn {
          from { opacity: 0; transform: translateY(4px) }
          to { opacity: 1; transform: translateY(0) }
        }
      `}</style>
    </Dialog.Root>
  );
}
