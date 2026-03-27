/**
 * QuickMemoFloat — floating memo input for PDF reader.
 *
 * Positioned at bottom-right of the reader viewport.
 * Auto-associates current paper. Accepts pre-filled text from selection.
 * Does not steal scroll focus from the PDF.
 *
 * See spec: section 1.6
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Send, FileText, Lightbulb, Tag } from 'lucide-react';
import { useCreateMemo } from '../../core/ipc/hooks/useMemos';

interface QuickMemoFloatProps {
  paperId: string;
  open: boolean;
  onClose: () => void;
  /** Pre-filled text (e.g., from text selection) */
  initialText?: string;
  /** Pre-filled concept IDs (e.g., from mapping review) */
  initialConceptIds?: string[];
}

export function QuickMemoFloat({
  paperId,
  open,
  onClose,
  initialText = '',
  initialConceptIds = [],
}: QuickMemoFloatProps) {
  const [text, setText] = useState(initialText);
  const [tags, setTags] = useState<string[]>([]);
  const [conceptIds, setConceptIds] = useState<string[]>(initialConceptIds);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const createMemo = useCreateMemo();

  // Reset when opened with new initial values.
  // Preserve the PDF text selection visually by saving the Range before focus.
  useEffect(() => {
    if (open) {
      setText(initialText);
      setConceptIds(initialConceptIds);

      // Save the current PDF text selection Range before textarea steals focus.
      // The browser will clear window.getSelection() when focus moves to the textarea.
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        savedRangeRef.current = selection.getRangeAt(0).cloneRange();
        // Apply a CSS class to the PDF text layer to keep visual highlighting
        // even after the DOM selection is cleared.
        addFakeHighlight(savedRangeRef.current);
      }

      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
    } else {
      // When closing, restore the real selection and remove fake highlight
      removeFakeHighlight();
      if (savedRangeRef.current) {
        try {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(savedRangeRef.current);
        } catch { /* selection restoration failed — non-critical */ }
        savedRangeRef.current = null;
      }
    }
  }, [open, initialText, initialConceptIds]);

  const handleSave = useCallback(async () => {
    if (!text.trim()) return;
    try {
      await createMemo.mutateAsync({
        text: text.trim(),
        paperIds: [paperId],
        conceptIds,
        tags,
      });
      setText('');
      setTags([]);
      setConceptIds([]);
      // Stay open for next memo
    } catch {
      // Error handled by mutation's onError
    }
  }, [text, paperId, conceptIds, tags, createMemo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }, [handleSave, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        right: 24,
        width: 320,
        background: 'var(--bg-surface, #1e293b)',
        border: '1px solid var(--border-default, var(--border-subtle))',
        borderRadius: 'var(--radius-lg, 8px)',
        boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.3))',
        zIndex: 30,
        overflow: 'hidden',
      }}
      // Prevent wheel events from reaching the PDF scroll container
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
      }}>
        <span>💡 Quick Memo</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Text area */}
      <div style={{ padding: '8px 12px' }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Record your thought..."
          rows={3}
          style={{
            width: '100%', resize: 'vertical',
            background: 'var(--bg-surface-low, var(--bg-surface))',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm, 4px)',
            padding: '6px 8px', fontSize: 12, lineHeight: 1.5,
            color: 'var(--text-primary)', outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Association chips */}
      <div style={{ padding: '0 12px 8px', display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 11 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 6px', borderRadius: 10,
          background: 'color-mix(in srgb, var(--accent-color, #3b82f6) 15%, transparent)',
          color: 'var(--accent-color, #3b82f6)',
        }}>
          <FileText size={10} /> {paperId.slice(0, 8)}…
        </span>
        {conceptIds.map((cid) => (
          <span key={cid} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 6px', borderRadius: 10,
            background: 'rgba(96,165,250,0.15)', color: '#60a5fa',
          }}>
            <Lightbulb size={10} /> {cid}
            <button
              onClick={() => setConceptIds((prev) => prev.filter((id) => id !== cid))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        padding: '8px 12px',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <button
          onClick={handleSave}
          disabled={!text.trim() || createMemo.isPending}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 12px', fontSize: 12, border: 'none',
            borderRadius: 'var(--radius-sm, 4px)',
            background: text.trim() ? 'var(--accent-color, #3b82f6)' : 'var(--bg-surface-high, var(--bg-surface))',
            color: text.trim() ? '#fff' : 'var(--text-muted)',
            cursor: text.trim() ? 'pointer' : 'default',
          }}
        >
          <Send size={12} /> Save ↵
        </button>
      </div>
    </div>
  );
}

// ─── Fake highlight helpers ───
// When the textarea steals focus, the browser clears the native text selection.
// We add a semi-transparent overlay div over the selected range rects to
// visually preserve the "selection" appearance while the user types.

const FAKE_HIGHLIGHT_CLASS = 'abyssal-fake-selection-highlight';

function addFakeHighlight(range: Range): void {
  removeFakeHighlight(); // clean up any previous
  try {
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i]!;
      const div = document.createElement('div');
      div.className = FAKE_HIGHLIGHT_CLASS;
      Object.assign(div.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        pointerEvents: 'none',
        zIndex: '20',
        borderRadius: '1px',
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(div);
    }
  } catch {
    // range.getClientRects() may fail if range is detached — non-critical
  }
}

function removeFakeHighlight(): void {
  const elements = document.querySelectorAll(`.${FAKE_HIGHLIGHT_CLASS}`);
  elements.forEach((el) => el.remove());
}
