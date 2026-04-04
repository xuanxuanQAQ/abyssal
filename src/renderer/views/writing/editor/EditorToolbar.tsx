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

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
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
  const [, setToolbarVersion] = useState(0);
  const [linkEditOpen, setLinkEditOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');

  // Keep toolbar active/disabled state in sync with current selection.
  useEffect(() => {
    if (!editor) return;
    const refresh = () => setToolbarVersion((v) => v + 1);
    editor.on('selectionUpdate', refresh);
    editor.on('transaction', refresh);
    editor.on('focus', refresh);
    editor.on('blur', refresh);
    return () => {
      editor.off('selectionUpdate', refresh);
      editor.off('transaction', refresh);
      editor.off('focus', refresh);
      editor.off('blur', refresh);
    };
  }, [editor]);

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

  const canRun = useCallback(
    (probe: (ed: Editor) => boolean): boolean => {
      if (!editor) return false;
      try {
        return probe(editor);
      } catch {
        return false;
      }
    },
    [editor],
  );

  const runToolbarCommand = useCallback(
    (name: string, command: (ed: Editor) => boolean) => {
      if (!editor) return;
      command(editor);
    },
    [editor],
  );

  const openLinkEditor = useCallback(() => {
    if (!editor) return;
    const previousUrl = (editor.getAttributes('link').href as string | undefined) ?? '';
    setLinkValue(previousUrl);
    setLinkEditOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkValue.trim();
    if (url.length === 0) {
      runToolbarCommand('unsetLink', (ed) => ed.chain().focus().extendMarkRange('link').unsetLink().run());
    } else {
      runToolbarCommand('setLink', (ed) => ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run());
    }
    setLinkEditOpen(false);
  }, [editor, linkValue, runToolbarCommand]);

  return (
    <div role="toolbar" aria-label="Editor toolbar" style={toolbarStyle} data-writing-toolbar="true">
      {/* ── Text format ── */}
      <ToolbarButton
        icon={<Bold size={ICON_SIZE} />}
        title={t('writing.editor.bold')}
        active={isActive('bold')}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleMark('bold').run())}
        onClick={() => runToolbarCommand('bold', (ed) => ed.chain().focus().toggleMark('bold').run())}
      />
      <ToolbarButton
        icon={<Italic size={ICON_SIZE} />}
        title={t('writing.editor.italic')}
        active={isActive('italic')}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleMark('italic').run())}
        onClick={() => runToolbarCommand('italic', (ed) => ed.chain().focus().toggleMark('italic').run())}
      />
      <ToolbarButton
        icon={<Strikethrough size={ICON_SIZE} />}
        title={t('writing.editor.strikethrough')}
        active={isActive('strike')}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleStrike().run())}
        onClick={() => runToolbarCommand('strike', (ed) => ed.chain().focus().toggleStrike().run())}
      />
      <ToolbarButton
        icon={<Code size={ICON_SIZE} />}
        title={t('writing.editor.code')}
        active={isActive('code')}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleCode().run())}
        onClick={() => runToolbarCommand('code', (ed) => ed.chain().focus().toggleCode().run())}
      />

      <Separator />

      {/* ── Heading ── */}
      <ToolbarButton
        icon={<Heading1 size={ICON_SIZE} />}
        title={t('writing.editor.heading1', { defaultValue: '一级标题' })}
        active={isActive('heading', { level: 1 })}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleHeading({ level: 1 }).run())}
        onClick={() => runToolbarCommand('heading1', (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run())}
      />
      <ToolbarButton
        icon={<Heading2 size={ICON_SIZE} />}
        title={t('writing.editor.heading2')}
        active={isActive('heading', { level: 2 })}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleHeading({ level: 2 }).run())}
        onClick={() => runToolbarCommand('heading2', (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run())}
      />
      <ToolbarButton
        icon={<Heading3 size={ICON_SIZE} />}
        title={t('writing.editor.heading3')}
        active={isActive('heading', { level: 3 })}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleHeading({ level: 3 }).run())}
        onClick={() => runToolbarCommand('heading3', (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run())}
      />

      <Separator />

      {/* ── Block ── */}
      <ToolbarButton
        icon={<List size={ICON_SIZE} />}
        title={t('writing.editor.bulletList')}
        active={isActive('bulletList')}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleBulletList().run())}
        onClick={() => runToolbarCommand('bulletList', (ed) => ed.chain().focus().toggleBulletList().run())}
      />
      <ToolbarButton
        icon={<ListOrdered size={ICON_SIZE} />}
        title={t('writing.editor.orderedList')}
        active={isActive('orderedList')}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleOrderedList().run())}
        onClick={() => runToolbarCommand('orderedList', (ed) => ed.chain().focus().toggleOrderedList().run())}
      />
      <ToolbarButton
        icon={<Quote size={ICON_SIZE} />}
        title={t('writing.editor.blockquote')}
        active={isActive('blockquote')}
        disabled={disabled || !canRun((ed) => ed.can().chain().focus().toggleBlockquote().run())}
        onClick={() => runToolbarCommand('blockquote', (ed) => ed.chain().focus().toggleBlockquote().run())}
      />

      <Separator />

      {/* ── Insert ── */}
      <ToolbarButton
        icon={<Link size={ICON_SIZE} />}
        title={t('writing.editor.insertLink')}
        active={isActive('link')}
        disabled={disabled}
        onClick={openLinkEditor}
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

      {linkEditOpen && (
        <>
          <input
            type="text"
            value={linkValue}
            placeholder="https://..."
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setLinkEditOpen(false);
              }
            }}
            style={{
              height: 26,
              minWidth: 220,
              padding: '0 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            style={aiLabelStyle}
            onClick={applyLink}
          >
            {t('common.apply', { defaultValue: '应用' })}
          </button>
          <button
            type="button"
            style={aiLabelStyle}
            onClick={() => setLinkEditOpen(false)}
          >
            {t('common.cancel')}
          </button>
          <Separator />
        </>
      )}

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
