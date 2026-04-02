import React, { useRef, useEffect } from 'react';
import { TextLayer as PDFJSTextLayer } from 'pdfjs-dist';
import { useReaderStore } from '../../../../core/store/useReaderStore';
import type { ContentBlockDTO } from '../../../../../shared-types/models';
import type { ColumnBounds } from '../../selection/dragEnvelope';
import { blockOverlaps } from '../../selection/dragEnvelope';
import './pdfTextLayer.css';

/** Block types where text selection should be suppressed */
const NON_TEXT_BLOCK_TYPES = new Set([
  'figure', 'figure_caption', 'table', 'table_caption',
  'table_footnote', 'formula', 'formula_caption', 'abandoned',
]);

/** Block types worth capturing as images */
const CAPTURABLE_TYPES = new Set(['figure', 'table', 'formula']);

export interface TextLayerProps {
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  scale: number;
  getPage: (pageNumber: number) => Promise<any>;
  isInRenderWindow: boolean;
  blocks?: ContentBlockDTO[];
  onBlockClick?: (block: ContentBlockDTO) => void;
  /** Per-page DLA highlight bounds from DragEnvelope (driven by useSelectionMachine) */
  dragBounds?: ColumnBounds[] | undefined;
}

// ---------------------------------------------------------------------------
// DLA overlay helpers
// ---------------------------------------------------------------------------

function addSelectionBlockers(
  container: HTMLElement,
  nonTextBlocks: ContentBlockDTO[],
  cssWidth: number,
  cssHeight: number,
): void {
  if (nonTextBlocks.length === 0 || cssWidth === 0 || cssHeight === 0) return;

  container.querySelectorAll('[data-dla-blocker]').forEach((el) => el.remove());

  for (const block of nonTextBlocks) {
    const div = document.createElement('div');
    div.setAttribute('data-dla-blocker', '1');
    div.setAttribute('data-block-type', block.type);
    div.setAttribute('data-bbox', JSON.stringify(block.bbox));
    div.style.position = 'absolute';
    div.style.left = `${block.bbox.x * cssWidth}px`;
    div.style.top = `${block.bbox.y * cssHeight}px`;
    div.style.width = `${block.bbox.w * cssWidth}px`;
    div.style.height = `${block.bbox.h * cssHeight}px`;
    div.style.userSelect = 'none';
    (div.style as any).webkitUserSelect = 'none';
    div.style.zIndex = '10';

    if (CAPTURABLE_TYPES.has(block.type)) {
      div.style.cursor = 'pointer';
      div.classList.add('dla-capturable');
    } else {
      div.style.cursor = 'default';
    }
    // pointer-events handled via CSS: auto normally, none during .selecting
    div.style.pointerEvents = 'auto';
    container.appendChild(div);
  }
}

/**
 * Disable user-select on OCR spans that fall inside blocker regions.
 * Uses getBoundingClientRect() for accurate position matching
 * (pdf.js positions spans via CSS transform, not style.left).
 */
function maskSpansUnderBlockers(container: HTMLElement): void {
  const blockers = container.querySelectorAll<HTMLElement>('[data-dla-blocker]');
  if (blockers.length === 0) return;

  // Collect blocker rects once
  const blockerRects: DOMRect[] = [];
  for (const b of blockers) blockerRects.push(b.getBoundingClientRect());

  const allSpans = container.querySelectorAll<HTMLElement>('span');
  for (const span of allSpans) {
    if (
      span.classList.contains('markedContent') ||
      span.getAttribute('data-dla-masked') === '1'
    ) continue;

    const rect = span.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (const bRect of blockerRects) {
      if (cx >= bRect.left && cx <= bRect.right && cy >= bRect.top && cy <= bRect.bottom) {
        span.style.userSelect = 'none';
        (span.style as any).webkitUserSelect = 'none';
        span.setAttribute('data-dla-masked', '1');
        break;
      }
    }
  }
}

function applyDLA(
  container: HTMLElement,
  blocks: ContentBlockDTO[],
  cssWidth: number,
  cssHeight: number,
): void {
  if (blocks.length === 0) return;
  const nonTextBlocks = blocks.filter(b => NON_TEXT_BLOCK_TYPES.has(b.type));
  addSelectionBlockers(container, nonTextBlocks, cssWidth, cssHeight);
  // Must run after blockers are in the DOM so their rects are available
  maskSpansUnderBlockers(container);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TextLayer = React.memo(function TextLayer(props: TextLayerProps) {
  const {
    pageNumber,
    cssWidth,
    cssHeight,
    scale,
    getPage,
    isInRenderWindow,
    blocks = [],
    onBlockClick,
    dragBounds,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);

  const blocksRef = useRef<ContentBlockDTO[]>(blocks);
  blocksRef.current = blocks;

  const onBlockClickRef = useRef(onBlockClick);
  onBlockClickRef.current = onBlockClick;

  // ---- Effect 1: Render text layer ----
  useEffect(() => {
    if (!isInRenderWindow) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    const renderTextLayer = async () => {
      const page = await getPage(pageNumber);
      if (cancelled) return;

      const textContent = await page.getTextContent();
      if (cancelled) return;

      const viewport = page.getViewport({ scale });

      const tempContainer = document.createElement('div');
      tempContainer.style.setProperty('--scale-factor', String(scale));

      const textLayer = new PDFJSTextLayer({
        textContentSource: textContent,
        container: tempContainer,
        viewport,
      });

      await textLayer.render();
      if (cancelled) return;

      while (container.firstChild) container.removeChild(container.firstChild);
      container.style.setProperty('--scale-factor', String(scale));
      while (tempContainer.firstChild) {
        container.appendChild(tempContainer.firstChild);
      }

      if (!container.querySelector('.endOfContent')) {
        const end = document.createElement('div');
        end.className = 'endOfContent';
        container.appendChild(end);
      }

      applyDLA(container, blocksRef.current, cssWidth, cssHeight);
    };

    renderTextLayer();
    return () => { cancelled = true; };
  }, [isInRenderWindow, pageNumber, scale, getPage, cssWidth, cssHeight]);

  // ---- Effect 2: Re-apply DLA when blocks arrive after render ----
  useEffect(() => {
    if (!isInRenderWindow) return;
    const container = containerRef.current;
    if (!container || container.childElementCount === 0) return;
    if (blocks.length === 0) return;

    applyDLA(container, blocks, cssWidth, cssHeight);
  }, [isInRenderWindow, blocks, cssWidth, cssHeight]);

  // ---- Effect 3: Selection management ----
  // a) Toggle .selecting class (activates endOfContent cover + disables blocker pointer-events via CSS)
  // b) Dynamic endOfContent repositioning (the key to preventing selection jumping)
  // c) Click on capturable blocker → select block
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isInRenderWindow) return;

    // --- a) mousedown: only start text-selection mode if not clicking a blocker ---
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.hasAttribute('data-dla-blocker')) return;
      container.classList.add('selecting');
    };

    const onUp = () => {
      container.classList.remove('selecting');
      const endDiv = container.querySelector('.endOfContent');
      if (endDiv) container.appendChild(endDiv);
    };

    // --- b) selectionchange: reposition endOfContent ---
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        container.classList.remove('selecting');
        return;
      }

      const range = sel.getRangeAt(0);
      if (!range.intersectsNode(container)) {
        container.classList.remove('selecting');
        return;
      }

      container.classList.add('selecting');

      // Dynamic endOfContent repositioning (pdf.js core mechanism)
      const endDiv = container.querySelector('.endOfContent');
      if (endDiv) {
        let anchor: Node | null = sel.focusNode;
        if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;

        if (
          anchor &&
          anchor !== endDiv &&
          anchor instanceof HTMLElement &&
          container.contains(anchor) &&
          !anchor.hasAttribute('data-dla-blocker')
        ) {
          const parent = anchor.parentElement;
          if (parent && container.contains(parent)) {
            try {
              parent.insertBefore(endDiv, anchor.nextSibling);
            } catch {
              container.appendChild(endDiv);
            }
          }
        }
      }
    };

    // --- c) Click on capturable blocker → select block ---
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.hasAttribute('data-dla-blocker')) return;
      if (!target.classList.contains('dla-capturable')) return;

      e.stopPropagation();
      e.preventDefault();

      const wasSelected = target.classList.contains('dla-selected');
      container.querySelectorAll('.dla-selected').forEach(
        (el) => el.classList.remove('dla-selected'),
      );

      if (!wasSelected) {
        target.classList.add('dla-selected');
        const blockType = target.getAttribute('data-block-type') ?? 'figure';
        const bboxStr = target.getAttribute('data-bbox');
        if (bboxStr && onBlockClickRef.current) {
          try {
            const bbox = JSON.parse(bboxStr);
            onBlockClickRef.current({
              type: blockType as ContentBlockDTO['type'],
              bbox,
              confidence: 1,
              pageIndex: pageNumber - 1,
            });
          } catch { /* ignore */ }
        }
      }
    };

    container.addEventListener('mousedown', onDown);
    container.addEventListener('click', onClick);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      container.removeEventListener('mousedown', onDown);
      container.removeEventListener('click', onClick);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      container.classList.remove('selecting');
    };
  }, [isInRenderWindow, pageNumber]);

  // ---- Effect 4: DLA highlight from dragBounds prop (pure geometry) ----
  // When useSelectionMachine provides dragBounds for this page during DRAGGING,
  // highlight capturable blockers that overlap the visual bounds.
  // No Selection API dependency — uses normalized coords from DragEnvelope.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isInRenderWindow) return;

    const blockers = container.querySelectorAll<HTMLElement>('[data-dla-blocker].dla-capturable');
    if (blockers.length === 0) return;

    if (!dragBounds || dragBounds.length === 0) {
      // Clear all highlights when no bounds
      blockers.forEach((el) => el.classList.remove('dla-drag-highlight'));
      return;
    }

    for (const blocker of blockers) {
      const bboxStr = blocker.getAttribute('data-bbox');
      if (!bboxStr) continue;
      try {
        const bbox = JSON.parse(bboxStr);
        if (blockOverlaps(bbox, dragBounds)) {
          blocker.classList.add('dla-drag-highlight');
        } else {
          blocker.classList.remove('dla-drag-highlight');
        }
      } catch {
        blocker.classList.remove('dla-drag-highlight');
      }
    }
  }, [isInRenderWindow, dragBounds]);

  if (!isInRenderWindow) return null;

  let pointerEvents: React.CSSProperties['pointerEvents'];
  if (activeAnnotationTool === 'areaHighlight' || activeAnnotationTool === 'hand') {
    pointerEvents = 'none';
  } else {
    pointerEvents = 'auto';
  }

  return (
    <div
      ref={containerRef}
      data-page={pageNumber}
      className="textLayer"
      style={{ pointerEvents }}
    />
  );
});

export { TextLayer };
