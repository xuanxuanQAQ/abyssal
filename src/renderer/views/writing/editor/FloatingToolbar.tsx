/**
 * FloatingToolbar -- BubbleMenu-based toolbar shown on text selection
 *
 * Appears above the selected text and provides:
 *   - Basic formatting: Bold, Italic, Strikethrough
 *   - AI quick actions: Rewrite, Expand, Compress, Continue Writing
 *
 * AI actions dispatch a custom DOM event (`ai:writingIntent`) that
 * ChatDock listens for to trigger intent-aware copilot operations.
 *
 * Uses @tiptap/react BubbleMenu which internally manages positioning
 * via the ProseMirror BubbleMenu plugin.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, Strikethrough, PenLine, Expand, Shrink, ArrowRight } from 'lucide-react';
import { Z_INDEX } from '../../../styles/zIndex';
import type { CopilotIntent } from '../../../../copilot-runtime/types';

// ── Types ──

interface FloatingToolbarProps {
  editor: Editor;
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

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  backgroundColor: 'var(--border-subtle)',
  margin: '0 2px',
  flexShrink: 0,
};

const aiBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--accent-color)',
  flexShrink: 0,
  opacity: 0.8,
};

// ── Component ──

export function FloatingToolbar({
  editor,
}: FloatingToolbarProps) {
  const { t } = useTranslation();
  const preventFocusLoss = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const dispatchIntent = useCallback((intent: CopilotIntent) => {
    window.dispatchEvent(new CustomEvent('ai:writingIntent', { detail: { intent } }));
  }, []);

  return (
    <BubbleMenu
      editor={editor}
      options={{
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
        <div style={separatorStyle} />

        {/* ── AI action buttons ── */}
        <button
          type="button"
          title={t('writing.editor.rewrite', { defaultValue: '改写' })}
          style={aiBtnStyle}
          onClick={() => dispatchIntent('rewrite-selection')}
        >
          <PenLine size={ICON_SIZE} />
        </button>

        <button
          type="button"
          title={t('writing.editor.expand', { defaultValue: '扩展' })}
          style={aiBtnStyle}
          onClick={() => dispatchIntent('expand-selection')}
        >
          <Expand size={ICON_SIZE} />
        </button>

        <button
          type="button"
          title={t('writing.editor.compress', { defaultValue: '压缩' })}
          style={aiBtnStyle}
          onClick={() => dispatchIntent('compress-selection')}
        >
          <Shrink size={ICON_SIZE} />
        </button>

        <button
          type="button"
          title={t('writing.editor.continueWriting', { defaultValue: '续写' })}
          style={aiBtnStyle}
          onClick={() => dispatchIntent('continue-writing')}
        >
          <ArrowRight size={ICON_SIZE} />
        </button>
      </div>
    </BubbleMenu>
  );
}
