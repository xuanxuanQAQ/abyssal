import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';

export function NotePopover({
  open,
  onOpenChange,
  anchorRect,
  initialText,
  onSave,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRect: { x: number; y: number } | null;
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  const handleSave = () => {
    onSave(text);
  };

  const handleCancel = () => {
    setText(initialText);
    onCancel();
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {anchorRect && (
        <Popover.Anchor asChild>
          <div
            style={{
              position: 'fixed',
              left: anchorRect.x,
              top: anchorRect.y,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </Popover.Anchor>
      )}
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          style={{
            zIndex: 30,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 'bold',
              color: 'var(--text-primary)',
            }}
          >
            {t('reader.annotations.addNote')}
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{
              width: 240,
              height: 120,
              resize: 'vertical',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: 8,
              fontSize: 'var(--text-sm)',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '4px 12px',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: '4px 12px',
                fontSize: 'var(--text-sm)',
                color: '#fff',
                backgroundColor: 'var(--accent-color)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              {t('common.save')}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
