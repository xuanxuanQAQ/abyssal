/**
 * PaperRefAutocomplete — [@paper_id] citation autocomplete popup.
 *
 * Triggered by typing "[@" in any text input. 300ms debounce search.
 * Renders floating candidate list positioned at cursor.
 * On selection, replaces "[@query" with "[@paper_id]".
 *
 * Can be integrated into Tiptap via @tiptap/suggestion extension.
 * This component provides the standalone popup UI.
 *
 * See spec: section 8.4
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { getAPI } from '../core/ipc/bridge';
import type { PaperFilter } from '../../shared-types/ipc';

// ─── Types ───

interface PaperCandidate {
  id: string;
  title: string;
  authors: string;
  year: number;
}

interface PaperRefAutocompleteProps {
  /** The partial query text (after "[@") */
  query: string;
  /** Pixel position for the popup */
  position: { x: number; y: number };
  /** Called when a paper is selected */
  onSelect: (paperId: string) => void;
  /** Called when popup should close */
  onClose: () => void;
}

// ─── Component ───

export function PaperRefAutocomplete({ query, position, onSelect, onClose }: PaperRefAutocompleteProps) {
  const [candidates, setCandidates] = useState<PaperCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // 300ms debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setCandidates([]);
      return;
    }

    setIsLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await getAPI().db.papers.list({ searchQuery: query, limit: 5 } as unknown as PaperFilter);
        const papers = (result as unknown as Array<Record<string, unknown>>).map((p) => ({
          id: (p['id'] as string) ?? '',
          title: (p['title'] as string) ?? '',
          authors: formatAuthors(p['authors'] as unknown),
          year: (p['year'] as number) ?? 0,
        }));
        setCandidates(papers);
        setSelectedIndex(0);
      } catch {
        setCandidates([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Keyboard navigation — uses capture phase on document to intercept before
  // other global handlers (GlobalSearch, MemoQuickInput), and stopPropagation
  // to prevent Esc from closing multiple overlays simultaneously.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if our popup is visible
      if (candidates.length === 0 && !isLoading) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, candidates.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && candidates.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(candidates[selectedIndex]!.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // Prevent Esc from bubbling to CommandPalette/other overlays
        onClose();
      }
    };

    // Capture phase: intercept before bubble-phase handlers on window
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [candidates, selectedIndex, onSelect, onClose, isLoading]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  if (candidates.length === 0 && !isLoading) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y + 20,
        width: 380,
        maxHeight: 240,
        overflow: 'auto',
        background: 'var(--bg-surface, #1e293b)',
        border: '1px solid var(--border-default, var(--border-subtle))',
        borderRadius: 'var(--radius-md, 6px)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 100,
        fontSize: 12,
      }}
    >
      {isLoading && (
        <div style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>Searching...</div>
      )}
      {candidates.map((paper, index) => (
        <div
          key={paper.id}
          onClick={() => onSelect(paper.id)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: index === selectedIndex ? 'var(--bg-hover, var(--bg-active))' : 'transparent',
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <FileText size={14} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {paper.title}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {paper.authors}{paper.year ? `, ${paper.year}` : ''}
              <span style={{ marginLeft: 8, fontFamily: 'monospace', opacity: 0.6 }}>
                [{paper.id}]
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ───

function formatAuthors(authors: unknown): string {
  if (!authors) return '';
  if (typeof authors === 'string') return authors;
  if (Array.isArray(authors)) {
    const names = authors.map((a) => {
      if (typeof a === 'string') return a;
      if (typeof a === 'object' && a !== null) return (a as Record<string, string>)['name'] ?? (a as Record<string, string>)['family'] ?? '';
      return '';
    }).filter(Boolean);
    if (names.length <= 2) return names.join(' & ');
    return `${names[0]} et al.`;
  }
  return '';
}
