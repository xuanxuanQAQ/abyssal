/**
 * FloatingToolbar -- BubbleMenu-based toolbar shown on text selection
 *
 * Appears above the selected text and provides:
 *   - Basic formatting: Bold, Italic, Strikethrough
 *   - AI operations on the selection: Rewrite, Expand, Compress
 *
 * Uses @tiptap/react BubbleMenu which internally manages positioning
 * via the ProseMirror BubbleMenu plugin.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BubbleMenu } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, Strikethrough, Sparkles } from 'lucide-react';
import { Z_INDEX } from '../../../styles/zIndex';

// ── Types ──

interface FloatingToolbarProps {
  editor: Editor;
  onAIRewrite?: (() => void) | undefined;
  onAIExpand?: (() => void) | undefined;
  onAICompress?: (() => void) | undefined;
}

// ── Styles ──

const ICON_SIZE = 14;

const menuStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '4px 6px',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'var(--bg-surface-high)',
  boxShadow: 'var(--shadow-md)',
  border: '1px solid var(--border-subtle)',
  zIndex: Z_INDEX.FLOATING_TOOLBAR,
};

function btnStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: active ? 'var(--accent-color-muted)' : 'transparent',
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
    flexShrink: 0,
  };
}

const aiButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 26,
  padding: '0 6px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  backgroundColor: 'var(--border-subtle)',
  margin: '0 2px',
  flexShrink: 0,
};

// ── Component ──

export function FloatingToolbar({
  editor,
  onAIRewrite,
  onAIExpand,
  onAICompress,
}: FloatingToolbarProps) {
  const { t } = useTranslation();
  const preventFocusLoss = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 150,
        placement: 'top',
      }}
    >
      <div style={menuStyle} onMouseDown={preventFocusLoss}>
        {/* ── Format buttons ── */}
        <button
          type="button"
          title={t('writing.editor.bold')}
          aria-pressed={editor.isActive('bold')}
          style={btnStyle(editor.isActive('bold'))}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={ICON_SIZE} />
        </button>

        <button
          type="button"
          title={t('writing.editor.italic')}
          aria-pressed={editor.isActive('italic')}
          style={btnStyle(editor.isActive('italic'))}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={ICON_SIZE} />
        </button>

        <button
          type="button"
          title={t('writing.editor.strikethrough')}
          aria-pressed={editor.isActive('strike')}
          style={btnStyle(editor.isActive('strike'))}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={ICON_SIZE} />
        </button>

        {/* ── Separator ── */}
        <div style={separatorStyle} aria-hidden />

        {/* ── AI operations ── */}
        <button
          type="button"
          title={t('writing.editor.aiRewrite')}
          style={aiButtonStyle}
          onClick={() => onAIRewrite?.()}
        >
          <Sparkles size={ICON_SIZE} />
          {t('writing.editor.rewrite')}
        </button>

        <button
          type="button"
          title={t('writing.editor.aiExpand')}
          style={aiButtonStyle}
          onClick={() => onAIExpand?.()}
        >
          <Sparkles size={ICON_SIZE} />
          {t('writing.editor.expand')}
        </button>

        <button
          type="button"
          title={t('writing.editor.aiCompress')}
          style={aiButtonStyle}
          onClick={() => onAICompress?.()}
        >
          <Sparkles size={ICON_SIZE} />
          {t('writing.editor.compress')}
        </button>
      </div>
    </BubbleMenu>
  );
}
