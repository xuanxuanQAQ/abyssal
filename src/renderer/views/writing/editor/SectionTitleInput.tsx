/**
 * SectionTitleInput -- independent title input above the editor (section-level)
 *
 * Displays a readonly numbering prefix (e.g. "2.1") followed by an editable
 * title field. Title changes are debounced at 500 ms before being flushed
 * upstream via `onTitleChange`. Pressing Enter moves focus to the TiptapEditor
 * via the optional `onEnterPress` callback.
 */

import React, { useCallback, useRef, useEffect } from 'react';

// ── Types ──

interface SectionTitleInputProps {
  numbering: string;
  title: string;
  onTitleChange: (title: string) => void;
  onEnterPress?: (() => void) | undefined;
}

// ── Constants ──

const DEBOUNCE_MS = 500;

// ── Component ──

export function SectionTitleInput({
  numbering,
  title,
  onTitleChange,
  onEnterPress,
}: SectionTitleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(title);

  // Keep the local ref in sync with external title changes (section switch).
  useEffect(() => {
    latestValueRef.current = title;
    if (inputRef.current && inputRef.current !== document.activeElement) {
      inputRef.current.value = title;
    }
  }, [title]);

  // Cleanup the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      latestValueRef.current = value;

      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        onTitleChange(latestValueRef.current);
        debounceTimer.current = null;
      }, DEBOUNCE_MS);
    },
    [onTitleChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();

        // Flush any pending debounced change immediately.
        if (debounceTimer.current !== null) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
          onTitleChange(latestValueRef.current);
        }

        onEnterPress?.();
      }
    },
    [onEnterPress, onTitleChange],
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        maxWidth: 720,
        margin: '0 auto',
        height: 32,
        gap: 8,
      }}
    >
      {/* Readonly numbering prefix */}
      {numbering && (
        <span
          style={{
            fontSize: 24,
            fontWeight: 700,
            lineHeight: '32px',
            color: 'var(--text-muted)',
            userSelect: 'none',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {numbering}
        </span>
      )}

      {/* Editable title */}
      <input
        ref={inputRef}
        type="text"
        defaultValue={title}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="节标题…"
        style={{
          flex: 1,
          height: 32,
          fontSize: 24,
          fontWeight: 700,
          lineHeight: '32px',
          border: 'none',
          outline: 'none',
          backgroundColor: 'transparent',
          color: 'var(--text-primary)',
          padding: 0,
        }}
      />
    </div>
  );
}
