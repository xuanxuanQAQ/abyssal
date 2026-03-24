import { useState, useEffect, useCallback, useRef } from 'react';

interface TextSelectionState {
  selectedText: string | null;
  selectionRange: Range | null;
  anchorPageNumber: number | null;
  selectionRects: DOMRect[] | null;
}

const NULL_STATE: TextSelectionState = {
  selectedText: null,
  selectionRange: null,
  anchorPageNumber: null,
  selectionRects: null,
};

function getPageNumber(node: Node): number | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  while (el) {
    const pageAttr = el.getAttribute('data-page');
    if (pageAttr !== null) {
      const num = parseInt(pageAttr, 10);
      return Number.isFinite(num) ? num : null;
    }
    el = el.parentElement;
  }
  return null;
}

function isInsideTextLayer(node: Node): boolean {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  while (el) {
    if (el.classList.contains('textLayer')) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function useTextSelection(): TextSelectionState & {
  clearSelection: () => void;
} {
  const [state, setState] = useState<TextSelectionState>(NULL_STATE);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleSelectionChange = (): void => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setState(NULL_STATE);
          return;
        }

        const { anchorNode } = sel;
        if (!anchorNode || !isInsideTextLayer(anchorNode)) {
          setState(NULL_STATE);
          return;
        }

        const range = sel.getRangeAt(0);
        const text = sel.toString();
        if (!text.trim()) {
          setState(NULL_STATE);
          return;
        }

        const pageNumber = getPageNumber(anchorNode);
        const clientRects = range.getClientRects();
        const rects: DOMRect[] = [];
        for (let i = 0; i < clientRects.length; i++) {
          rects.push(clientRects[i]!);
        }

        setState({
          selectedText: text,
          selectionRange: range,
          anchorPageNumber: pageNumber,
          selectionRects: rects.length > 0 ? rects : null,
        });
      }, 50);
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const clearSelection = useCallback((): void => {
    window.getSelection()?.removeAllRanges();
    setState(NULL_STATE);
  }, []);

  return { ...state, clearSelection };
}
