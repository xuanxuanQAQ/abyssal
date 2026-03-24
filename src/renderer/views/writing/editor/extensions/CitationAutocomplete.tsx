/**
 * CitationAutocomplete — Floating autocomplete panel triggered by `[@` input.
 *
 * Two exports:
 * 1. createCitationAutocompletePlugin() — ProseMirror Plugin that monitors input
 * 2. CitationAutocompletePanel — React component for the floating UI
 *
 * Width: min(400px, editorWidth - 40px), max-height: 240px (scrollable)
 * z-index: 25 (FLOATING_TOOLBAR)
 * Keyboard: Up/Down navigate, Enter/Tab select, Escape close.
 * On select: delete `[@...` text, insert CitationNode, move cursor after.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';
import { Z_INDEX } from '../../../../styles/zIndex';
import { CITATION_PARTIAL_REGEX } from '../../shared/citationPattern';

// ─── Types ───

interface PaperItem {
  id: string;
  title: string;
  firstAuthor: string;
  year: number;
}

interface AutocompleteState {
  active: boolean;
  query: string;
  from: number;
  to: number;
  coords: { left: number; top: number } | null;
}

// ─── Plugin ───

export const citationAutocompletePluginKey = new PluginKey<AutocompleteState>(
  'citationAutocomplete',
);

/**
 * Detect `[@` pattern in editor input and maintain autocomplete state.
 * The React component reads this plugin's state to render the panel.
 */
export function createCitationAutocompletePlugin(
  onStateChange: (state: AutocompleteState) => void,
): Plugin<AutocompleteState> {
  return new Plugin<AutocompleteState>({
    key: citationAutocompletePluginKey,

    state: {
      init(): AutocompleteState {
        return { active: false, query: '', from: 0, to: 0, coords: null };
      },

      apply(tr, prev, _oldState, newState): AutocompleteState {
        // If the document or selection changed, recompute
        if (!tr.docChanged && !tr.selectionSet) return prev;

        const { selection } = newState;
        if (!selection.empty) {
          if (prev.active) {
            const next: AutocompleteState = {
              active: false,
              query: '',
              from: 0,
              to: 0,
              coords: null,
            };
            onStateChange(next);
            return next;
          }
          return prev;
        }

        const $pos = selection.$from;
        const textBefore = $pos.parent.textBetween(
          Math.max(0, $pos.parentOffset - 50),
          $pos.parentOffset,
          undefined,
          '\ufffc',
        );

        // Look for `[@` pattern followed by optional query text
        const match = CITATION_PARTIAL_REGEX.exec(textBefore);

        if (match) {
          const query = match[1] ?? '';
          const matchStart = $pos.pos - (match[0]?.length ?? 0);
          const next: AutocompleteState = {
            active: true,
            query,
            from: matchStart,
            to: $pos.pos,
            coords: null, // Coords are set by the view via decorations or direct lookup
          };
          onStateChange(next);
          return next;
        }

        if (prev.active) {
          const next: AutocompleteState = {
            active: false,
            query: '',
            from: 0,
            to: 0,
            coords: null,
          };
          onStateChange(next);
          return next;
        }

        return prev;
      },
    },

    props: {
      handleKeyDown(view, event) {
        const pluginState = citationAutocompletePluginKey.getState(view.state);
        if (!pluginState?.active) return false;

        // Let the React component handle these keys via its own keydown listener
        if (
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown' ||
          event.key === 'Enter' ||
          event.key === 'Tab'
        ) {
          // Prevent ProseMirror default behaviour so the autocomplete can handle it
          return true;
        }

        if (event.key === 'Escape') {
          return true;
        }

        return false;
      },
    },
  });
}

// ─── React Component ───

const MAX_RESULTS = 8;

interface CitationAutocompletePanelProps {
  editor: Editor;
  state: AutocompleteState;
  onDismiss: () => void;
}

/**
 * Stub for paper list until the real hook is integrated.
 * TODO: replace with usePaperList from ../../../../core/ipc/hooks/usePapers
 */
function usePaperListStub(): PaperItem[] {
  // TODO: wire up real paper data
  return [];
}

function filterPapers(papers: PaperItem[], query: string): PaperItem[] {
  if (!query) return papers.slice(0, MAX_RESULTS);

  const lowerQuery = query.toLowerCase();
  return papers
    .filter(
      (p) =>
        p.id.toLowerCase().includes(lowerQuery) ||
        p.title.toLowerCase().includes(lowerQuery) ||
        p.firstAuthor.toLowerCase().includes(lowerQuery),
    )
    .slice(0, MAX_RESULTS);
}

export function CitationAutocompletePanel({
  editor,
  state,
  onDismiss,
}: CitationAutocompletePanelProps): React.ReactElement | null {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const papers = usePaperListStub();
  const filteredPapers = filterPapers(papers, state.query);

  // Reset index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [state.query]);

  const insertCitation = useCallback(
    (paper: PaperItem) => {
      const { view } = editor;
      if (!view) return;

      const nodeType = view.state.schema.nodes.citationNode;
      if (!nodeType) return;

      const citationNode = nodeType.create({
        paperId: paper.id,
        displayText: `@${paper.id}`,
      });

      const tr = view.state.tr.replaceWith(state.from, state.to, citationNode);
      // Move cursor after the node
      const resolvedPos = tr.doc.resolve(state.from + citationNode.nodeSize);
      tr.setSelection(TextSelection.near(resolvedPos));
      view.dispatch(tr);
      view.focus();
      onDismiss();
    },
    [editor, state.from, state.to, onDismiss],
  );

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!state.active) return;

      switch (event.key) {
        case 'ArrowUp': {
          event.preventDefault();
          setSelectedIndex((prev) => (prev <= 0 ? filteredPapers.length - 1 : prev - 1));
          break;
        }
        case 'ArrowDown': {
          event.preventDefault();
          setSelectedIndex((prev) => (prev >= filteredPapers.length - 1 ? 0 : prev + 1));
          break;
        }
        case 'Enter':
        case 'Tab': {
          event.preventDefault();
          const selected = filteredPapers[selectedIndex];
          if (selected) {
            insertCitation(selected);
          }
          break;
        }
        case 'Escape': {
          event.preventDefault();
          onDismiss();
          break;
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [state.active, filteredPapers, selectedIndex, insertCitation, onDismiss]);

  if (!state.active) return null;

  // Compute position from editor view
  const coords = (() => {
    try {
      return editor.view.coordsAtPos(state.from);
    } catch {
      return null;
    }
  })();

  if (!coords) return null;

  const editorRect = editor.view.dom.getBoundingClientRect();
  const maxWidth = Math.min(400, editorRect.width - 40);

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    left: `${coords.left}px`,
    top: `${coords.bottom + 4}px`,
    width: `${maxWidth}px`,
    maxHeight: '240px',
    overflowY: 'auto',
    zIndex: Z_INDEX.FLOATING_TOOLBAR,
    backgroundColor: 'var(--bg-surface, #1e1e2e)',
    border: '1px solid var(--border-color, #333)',
    borderRadius: '6px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    padding: '4px 0',
  };

  const itemStyle = (isSelected: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    backgroundColor: isSelected ? 'var(--accent-color-muted, rgba(137,180,250,0.15))' : 'transparent',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  });

  return (
    <div ref={listRef} style={panelStyle} role="listbox">
      {filteredPapers.length === 0 ? (
        <div
          style={{
            padding: '12px 16px',
            color: 'var(--text-secondary, #a6adc8)',
            fontSize: '13px',
          }}
        >
          {papers.length === 0 ? 'No papers loaded' : `No matches for "${state.query}"`}
        </div>
      ) : (
        filteredPapers.map((paper, index) => (
          <div
            key={paper.id}
            style={itemStyle(index === selectedIndex)}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseDown={(e) => {
              e.preventDefault();
              insertCitation(paper);
            }}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span
              style={{
                fontWeight: 500,
                color: 'var(--text-primary, #cdd6f4)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {paper.title}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary, #a6adc8)',
              }}
            >
              {paper.firstAuthor} ({paper.year}) — {paper.id}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
