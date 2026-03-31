/**
 * EditorToolbar -- fixed toolbar (40 px) above the Tiptap editor
 *
 * Groups:
 *   1. Text format   — Bold, Italic, Strikethrough, Code
 *   2. Heading        — H2, H3 only (no H1 per section-level design)
 *   3. Block          — BulletList, OrderedList, Blockquote
 *   4. Insert + AI    — Link, Math, Cite, AI Generate / Rewrite / Expand
 *
 * When `aiGenerating === true` the AI buttons collapse into a
 * "[generating...] [cancel]" indicator.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link,
  Sigma,
  AtSign,
  ImagePlus,
  Sparkles,
  StopCircle,
} from 'lucide-react';

// ── Types ──

interface EditorToolbarProps {
  editor: Editor | null;
  aiGenerating: boolean;
  onAIGenerate?: (() => void) | undefined;
  onAIRewrite?: (() => void) | undefined;
  onAIExpand?: (() => void) | undefined;
  onAICancel?: (() => void) | undefined;
  onInsertCitation?: (() => void) | undefined;
  onInsertMath?: (() => void) | undefined;
  onInsertImage?: (() => void) | undefined;
}

// ── Styles ──

const TOOLBAR_HEIGHT = 40;
const ICON_SIZE = 16;

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: TOOLBAR_HEIGHT,
  padding: '0 8px',
  gap: 2,
  borderBottom: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface-low)',
  flexShrink: 0,
  overflowX: 'auto',
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  backgroundColor: 'var(--border-subtle)',
  margin: '0 4px',
  flexShrink: 0,
};

function buttonStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    backgroundColor: active ? 'var(--accent-color-muted)' : 'transparent',
    color: disabled
      ? 'var(--text-disabled)'
      : active
        ? 'var(--accent-color)'
        : 'var(--text-secondary)',
    flexShrink: 0,
  };
}

const aiLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 8px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs)',
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

// ── Separator ──

function Separator() {
  return <div style={separatorStyle} aria-hidden />;
}

// ── ToolbarButton ──

interface TBProps {
  icon: React.ReactNode;
  title: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ToolbarButton({ icon, title, active, disabled, onClick }: TBProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      style={buttonStyle(active, disabled)}
      onMouseDown={(e) => e.preventDefault()} // keep editor focus
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

// ── Component ──

export function EditorToolbar({
  editor,
  aiGenerating,
  onAIGenerate,
  onAIRewrite,
  onAIExpand,
  onAICancel,
  onInsertCitation,
  onInsertMath,
  onInsertImage,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const disabled = editor === null;

  // ── Format helpers ──

  const toggle = useCallback(
    (cmd: () => void) => {
      if (!disabled) cmd();
    },
    [disabled],
  );

  const isActive = useCallback(
    (name: string, attrs?: Record<string, unknown>): boolean => {
      if (!editor) return false;
      return editor.isActive(name, attrs);
    },
    [editor],
  );

  return (
    <div role="toolbar" aria-label="Editor toolbar" style={toolbarStyle}>
      {/* ── Text format ── */}
      <ToolbarButton
        icon={<Bold size={ICON_SIZE} />}
        title={t('writing.editor.bold')}
        active={isActive('bold')}
        disabled={disabled}
        onClick={() => toggle(() => editor!.chain().focus().toggleBold().run())}
      />
      <ToolbarButton
        icon={<Italic size={ICON_SIZE} />}
        title={t('writing.editor.italic')}
        active={isActive('italic')}
        disabled={disabled}
        onClick={() => toggle(() => editor!.chain().focus().toggleItalic().run())}
      />
      <ToolbarButton
        icon={<Strikethrough size={ICON_SIZE} />}
        title={t('writing.editor.strikethrough')}
        active={isActive('strike')}
        disabled={disabled}
        onClick={() => toggle(() => editor!.chain().focus().toggleStrike().run())}
      />
      <ToolbarButton
        icon={<Code size={ICON_SIZE} />}
        title={t('writing.editor.code')}
        active={isActive('code')}
        disabled={disabled}
        onClick={() => toggle(() => editor!.chain().focus().toggleCode().run())}
      />

      <Separator />

      {/* ── Heading ── */}
      <ToolbarButton
        icon={<Heading2 size={ICON_SIZE} />}
        title={t('writing.editor.heading2')}
        active={isActive('heading', { level: 2 })}
        disabled={disabled}
        onClick={() =>
          toggle(() => editor!.chain().focus().toggleHeading({ level: 2 }).run())
        }
      />
      <ToolbarButton
        icon={<Heading3 size={ICON_SIZE} />}
        title={t('writing.editor.heading3')}
        active={isActive('heading', { level: 3 })}
        disabled={disabled}
        onClick={() =>
          toggle(() => editor!.chain().focus().toggleHeading({ level: 3 }).run())
        }
      />

      <Separator />

      {/* ── Block ── */}
      <ToolbarButton
        icon={<List size={ICON_SIZE} />}
        title={t('writing.editor.bulletList')}
        active={isActive('bulletList')}
        disabled={disabled}
        onClick={() =>
          toggle(() => editor!.chain().focus().toggleBulletList().run())
        }
      />
      <ToolbarButton
        icon={<ListOrdered size={ICON_SIZE} />}
        title={t('writing.editor.orderedList')}
        active={isActive('orderedList')}
        disabled={disabled}
        onClick={() =>
          toggle(() => editor!.chain().focus().toggleOrderedList().run())
        }
      />
      <ToolbarButton
        icon={<Quote size={ICON_SIZE} />}
        title={t('writing.editor.blockquote')}
        active={isActive('blockquote')}
        disabled={disabled}
        onClick={() =>
          toggle(() => editor!.chain().focus().toggleBlockquote().run())
        }
      />

      <Separator />

      {/* ── Insert ── */}
      <ToolbarButton
        icon={<Link size={ICON_SIZE} />}
        title={t('writing.editor.insertLink')}
        active={isActive('link')}
        disabled={disabled}
        onClick={() => {
          if (!editor) return;
          const previousUrl = editor.getAttributes('link').href as
            | string
            | undefined;
          const url = window.prompt('URL', previousUrl ?? '');
          if (url === null) return;
          if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
          } else {
            editor
              .chain()
              .focus()
              .extendMarkRange('link')
              .setLink({ href: url })
              .run();
          }
        }}
      />
      <ToolbarButton
        icon={<Sigma size={ICON_SIZE} />}
        title={t('writing.editor.insertMath')}
        active={false}
        disabled={disabled}
        onClick={() => onInsertMath?.()}
      />
      <ToolbarButton
        icon={<AtSign size={ICON_SIZE} />}
        title={t('writing.editor.insertCitation')}
        active={false}
        disabled={disabled}
        onClick={() => onInsertCitation?.()}
      />
      <ToolbarButton
        icon={<ImagePlus size={ICON_SIZE} />}
        title={t('writing.editor.insertImage', { defaultValue: '插入图片' })}
        active={false}
        disabled={disabled}
        onClick={() => onInsertImage?.()}
      />

      <Separator />

      {/* ── AI ── */}
      {aiGenerating ? (
        <>
          <span
            style={{
              ...aiLabelStyle,
              cursor: 'default',
              color: 'var(--accent-color)',
            }}
          >
            <Sparkles size={ICON_SIZE} />
            {t('writing.editor.generating')}
          </span>
          <button
            type="button"
            style={{
              ...aiLabelStyle,
              color: 'var(--text-danger)',
            }}
            onClick={() => onAICancel?.()}
          >
            <StopCircle size={ICON_SIZE} />
            {t('common.cancel')}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            title={t('writing.editor.aiGenerate')}
            style={aiLabelStyle}
            disabled={disabled}
            onClick={() => onAIGenerate?.()}
          >
            <Sparkles size={ICON_SIZE} />
            {t('writing.editor.generate')}
          </button>
          <button
            type="button"
            title={t('writing.editor.aiRewrite')}
            style={aiLabelStyle}
            disabled={disabled}
            onClick={() => onAIRewrite?.()}
          >
            <Sparkles size={ICON_SIZE} />
            {t('writing.editor.rewrite')}
          </button>
          <button
            type="button"
            title={t('writing.editor.aiExpand')}
            style={aiLabelStyle}
            disabled={disabled}
            onClick={() => onAIExpand?.()}
          >
            <Sparkles size={ICON_SIZE} />
            {t('writing.editor.expand')}
          </button>
        </>
      )}
    </div>
  );
}
