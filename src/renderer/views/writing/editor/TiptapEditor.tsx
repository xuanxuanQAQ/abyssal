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
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import { useEditorStore } from '../../../core/store/useEditorStore';
// Custom extensions
import { citationExtension } from './extensions/citationExtension';
import { paragraphMarkPlugin } from './extensions/paragraphMarkPlugin';
import { paragraphIdPlugin } from './extensions/paragraphIdPlugin';
import { mathExtension } from './extensions/mathExtension';
import { aiStreamingBlockExtension } from './extensions/aiStreamingBlockExtension';
import { outlineHeadingExtension } from './extensions/outlineHeadingExtension';
import { imageExtension } from './extensions/imageExtension';
import { footnoteExtension } from './extensions/footnoteExtension';
import { crossRefExtension } from './extensions/crossRefExtension';
import { equationNumberingPlugin } from './extensions/equationNumberingPlugin';

// ── Types ──

export interface TiptapEditorHandle {
  getEditor(): Editor | null;
  focus(): void;
}

interface TiptapEditorProps {
  content: string; // Markdown content or JSON to load initially
  contentJson?: object | null; // ProseMirror JSON (takes precedence over content)
  onUpdate?: ((markdown: string) => void) | undefined;
  onJsonUpdate?: ((json: object) => void) | undefined;
  /** Called once when the Tiptap editor instance is created */
  onEditorReady?: ((editor: Editor) => void) | undefined;
  /** Whether to use the article-wide heading-driven document mode */
  unifiedMode?: boolean;
}

// ── Extension configuration ──

function createExtensions(unifiedMode: boolean = false) {
  return [
    StarterKit.configure({
      heading: false,
      link: false,
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
    paragraphIdPlugin,
    ...mathExtension,
    aiStreamingBlockExtension,
    outlineHeadingExtension.configure({
      levels: unifiedMode ? [1, 2, 3, 4, 5, 6] : [2, 3],
    }),
    imageExtension,
    footnoteExtension,
    crossRefExtension,
    equationNumberingPlugin,
  ];
}

// ── Component ──

const TiptapEditorInner = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditorInner({ content, contentJson, onUpdate, onJsonUpdate, onEditorReady, unifiedMode }, ref) {
    const setEditorFocused = useEditorStore((s) => s.setEditorFocused);
    const setUnsavedChanges = useEditorStore((s) => s.setUnsavedChanges);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const editorRef = useRef<Editor | null>(null);

    const handleUpdate = useCallback(
      ({ editor: ed }: { editor: Editor }) => {
        editorRef.current = ed;
        setUnsavedChanges(true);
        onJsonUpdate?.(ed.getJSON());

        // Debounce serialization to avoid per-keystroke full DOM traversal.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (editorRef.current && !editorRef.current.isDestroyed) {
            onUpdate?.(editorRef.current.getHTML());
          }
        }, 300);
      },
      [onUpdate, onJsonUpdate, setUnsavedChanges],
    );

    const handleFocus = useCallback(() => {
      setEditorFocused(true);
    }, [setEditorFocused]);

    const handleBlur = useCallback(() => {
      setEditorFocused(false);
    }, [setEditorFocused]);

    const initialContent = contentJson ?? content;

    const editor = useEditor({
      extensions: createExtensions(unifiedMode ?? false),
      content: initialContent,
      editable: true,
      onUpdate: handleUpdate,
      onFocus: handleFocus,
      onBlur: handleBlur,
      editorProps: {
        attributes: {
          class: 'tiptap-editor-content',
          'data-writing-editor': 'true',
        },
      },
    });

    // Notify parent when the editor instance is ready.
    const editorReadyFiredRef = React.useRef(false);
    useEffect(() => {
      if (editor && !editorReadyFiredRef.current) {
        editorReadyFiredRef.current = true;
        onEditorReady?.(editor);
      }
    }, [editor, onEditorReady]);

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
        editor.commands.setContent(content, { emitUpdate: false });
        setUnsavedChanges(false);
      }
    }, [content, editor, setUnsavedChanges]);

    // When the external `contentJson` prop changes (unified doc reload),
    // replace the editor content.
    const contentJsonRef = React.useRef(contentJson);
    useEffect(() => {
      if (contentJsonRef.current === contentJson) return;
      contentJsonRef.current = contentJson;

      if (editor && !editor.isDestroyed && contentJson) {
        editor.commands.setContent(contentJson, { emitUpdate: false });
        setUnsavedChanges(false);
      }
    }, [contentJson, editor, setUnsavedChanges]);

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
        onMouseDown={(event) => {
          if (!editor) return;

          const target = event.target as HTMLElement;
          if (target.closest('[data-writing-toolbar="true"]')) {
            return;
          }
          const clickedInsideEditor = target.closest('.ProseMirror') !== null;

          // Click on wrapper blank area: focus editor and move caret near click.
          if (!clickedInsideEditor) {
            const coords = { left: event.clientX, top: event.clientY };
            const resolved = editor.view.posAtCoords(coords);
            if (resolved?.pos != null) {
              editor.chain().focus().setTextSelection(resolved.pos).run();
            } else {
              const endPos = editor.state.doc.content.size;
              editor.chain().focus().setTextSelection(endPos).run();
            }
            return;
          }

          editor.chain().focus().run();
        }}
        style={{
          width: '100%',
          margin: 0,
          padding: '16px 20px 24px',
          flex: 1,
          minHeight: 0,
          height: '100%',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          cursor: 'text',
        }}
      >
        <EditorContent editor={editor} />
      </div>
    );
  },
);

export const TiptapEditor = React.memo(TiptapEditorInner);
