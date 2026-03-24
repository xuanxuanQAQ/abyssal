/**
 * TiptapEditor -- core rich-text editor wrapping Tiptap v2 + ProseMirror
 *
 * - React.memo prevents unnecessary re-renders.
 * - Editor instance is exposed to the parent via forwardRef + useImperativeHandle.
 * - Heading levels restricted to [2, 3] (no H1 -- handled by SectionTitleInput).
 * - Custom extensions: citation, paragraph mark plugin, math, AI streaming block.
 * - Focus / blur / update events are forwarded to useEditorStore.
 */

import React, { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import { useEditorStore } from '../../../core/store/useEditorStore';
// Custom extensions
import { citationExtension } from './extensions/citationExtension';
import { paragraphMarkPlugin } from './extensions/paragraphMarkPlugin';
import { mathExtension } from './extensions/mathExtension';
import { aiStreamingBlockExtension } from './extensions/aiStreamingBlockExtension';

// ── Types ──

export interface TiptapEditorHandle {
  getEditor(): Editor | null;
  focus(): void;
}

interface TiptapEditorProps {
  content: string; // Markdown content to load initially
  onUpdate?: ((markdown: string) => void) | undefined;
}

// ── Extension configuration ──

function createExtensions() {
  return [
    StarterKit.configure({
      heading: {
        levels: [2, 3],
      },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
    Highlight,
    Subscript,
    Superscript,
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    Placeholder.configure({
      placeholder: '开始撰写…',
    }),
    citationExtension,
    paragraphMarkPlugin,
    ...mathExtension,
    aiStreamingBlockExtension,
  ];
}

// ── Component ──

const TiptapEditorInner = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditorInner({ content, onUpdate }, ref) {
    const setEditorFocused = useEditorStore((s) => s.setEditorFocused);
    const setUnsavedChanges = useEditorStore((s) => s.setUnsavedChanges);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const editorRef = useRef<Editor | null>(null);

    const handleUpdate = useCallback(
      ({ editor: ed }: { editor: Editor }) => {
        editorRef.current = ed;
        setUnsavedChanges(true);

        // Debounce HTML serialization to avoid per-keystroke full DOM traversal.
        // setUnsavedChanges fires immediately; the expensive getHTML() is deferred.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (editorRef.current && !editorRef.current.isDestroyed) {
            onUpdate?.(editorRef.current.getHTML());
          }
        }, 300);
      },
      [onUpdate, setUnsavedChanges],
    );

    const handleFocus = useCallback(() => {
      setEditorFocused(true);
    }, [setEditorFocused]);

    const handleBlur = useCallback(() => {
      setEditorFocused(false);
    }, [setEditorFocused]);

    const editor = useEditor({
      extensions: createExtensions(),
      content,
      onUpdate: handleUpdate,
      onFocus: handleFocus,
      onBlur: handleBlur,
      editorProps: {
        attributes: {
          class: 'tiptap-editor-content',
        },
      },
    });

    // Expose the editor instance to the parent.
    useImperativeHandle(
      ref,
      () => ({
        getEditor() {
          return editor;
        },
        focus() {
          editor?.chain().focus().run();
        },
      }),
      [editor],
    );

    // When the external `content` prop changes (section switch), replace the
    // editor content without creating an undo-history entry.
    const contentRef = React.useRef(content);
    useEffect(() => {
      if (contentRef.current === content) return;
      contentRef.current = content;

      if (editor && !editor.isDestroyed) {
        // Prevent the update callback from marking as unsaved during
        // programmatic content replacement.
        editor.commands.setContent(content, false);
        setUnsavedChanges(false);
      }
    }, [content, editor, setUnsavedChanges]);

    // Clean up the debounce timer when the component unmounts.
    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    // Clean up focus state when the editor unmounts.
    useEffect(() => {
      return () => {
        setEditorFocused(false);
      };
    }, [setEditorFocused]);

    return (
      <div
        className="tiptap-editor-wrapper"
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: 24,
          flex: 1,
          overflowY: 'auto',
        }}
      >
        <EditorContent editor={editor} />
      </div>
    );
  },
);

export const TiptapEditor = React.memo(TiptapEditorInner);
