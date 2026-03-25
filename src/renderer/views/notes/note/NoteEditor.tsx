/**
 * NoteEditor — 结构化笔记编辑器（§3.3）
 *
 * 复用 Writing View 的 TiptapEditor。
 * frontmatter 容错解析：解析失败时仍保存文件内容，显示黄色警告条。
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useNoteFileContent, useSaveNoteFile } from '../../../core/ipc/hooks/useNotes';

interface NoteEditorProps {
  noteId: string;
  onBack: () => void;
}

export function NoteEditor({ noteId, onBack }: NoteEditorProps) {
  const { data: initialContent, isLoading } = useNoteFileContent(noteId);
  const saveMutation = useSaveNoteFile();
  const [content, setContent] = useState('');
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (initialContent !== undefined) {
      setContent(initialContent);
    }
  }, [initialContent]);

  // Auto-save with 1500ms debounce
  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        saveMutation.mutate(
          { noteId, content: newContent },
          {
            onSuccess: (result) => {
              if (!result.frontmatterValid) {
                setFrontmatterError(result.frontmatterError ?? 'Frontmatter 语法有误');
              } else {
                setFrontmatterError(null);
              }
            },
          },
        );
      }, 1500);
    },
    [noteId, saveMutation],
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  if (isLoading) {
    return <div style={{ padding: 32, color: 'var(--text-muted)', textAlign: 'center' }}>加载中...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <ArrowLeft size={14} /> 返回列表
        </button>
        {saveMutation.isPending && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>保存中...</span>
        )}
      </div>

      {/* Frontmatter warning */}
      {frontmatterError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
          backgroundColor: '#FEF3C7', color: '#92400E', fontSize: 12,
        }}>
          <AlertTriangle size={14} />
          Frontmatter 语法有误，元数据暂不同步——修正后自动恢复
        </div>
      )}

      {/* Editor area — TODO: integrate TiptapEditor component */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          style={{
            width: '100%', height: '100%', border: 'none', outline: 'none', resize: 'none',
            fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)',
            backgroundColor: 'transparent', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
          placeholder="开始编写..."
        />
      </div>
    </div>
  );
}
