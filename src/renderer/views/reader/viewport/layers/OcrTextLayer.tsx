/**
 * OcrTextLayer — renders OCR word-level text spans for scanned pages.
 *
 * Replaces the pdf.js TextLayer for pages where we have Tesseract OCR
 * bbox data. Each word is rendered as a transparent <span> positioned
 * by its own bbox, enabling precise browser-native text selection.
 *
 * When word-level data is unavailable (legacy data), falls back to
 * line-level rendering.
 *
 * Reuses the same CSS class (.textLayer) and DLA blocker logic from TextLayer.
 */

import React, { useRef, useEffect } from 'react';
import { useReaderStore } from '../../../../core/store/useReaderStore';
import type { ContentBlockDTO, OcrLineDTO } from '../../../../../shared-types/models';
import type { ColumnBounds } from '../../selection/dragEnvelope';
import { blockOverlaps } from '../../selection/dragEnvelope';
import './pdfTextLayer.css';

/** CJK-first font stack for better character width matching with scanned documents */
const OCR_FONT_FAMILY = '"Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", SimSun, STSong, sans-serif';

/** DLA block types that represent text content columns */
const TEXT_BLOCK_TYPES = new Set(['text', 'title']);

interface NormBBox { x: number; y: number; w: number; h: number }

/**
 * Clip an OCR bbox to its containing DLA text block.
 * This prevents OCR spans from visually extending beyond column boundaries.
 */
function clipBBoxToBlock(
  bbox: NormBBox,
  textBlocks: Array<{ bbox: NormBBox }>,
): NormBBox {
  if (textBlocks.length === 0) return bbox;

  // Find the text block that best contains this bbox (largest overlap)
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;

  let bestBlock: { bbox: NormBBox } | null = null;
  let bestOverlap = 0;

  for (const block of textBlocks) {
    // Check if center point is inside block
    if (
      cx >= block.bbox.x && cx <= block.bbox.x + block.bbox.w &&
      cy >= block.bbox.y && cy <= block.bbox.y + block.bbox.h
    ) {
      // Compute overlap area
      const ox0 = Math.max(bbox.x, block.bbox.x);
      const oy0 = Math.max(bbox.y, block.bbox.y);
      const ox1 = Math.min(bbox.x + bbox.w, block.bbox.x + block.bbox.w);
      const oy1 = Math.min(bbox.y + bbox.h, block.bbox.y + block.bbox.h);
      const overlap = Math.max(0, ox1 - ox0) * Math.max(0, oy1 - oy0);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestBlock = block;
      }
    }
  }

  if (!bestBlock) return bbox;

  // Clip bbox to block boundaries
  const x0 = Math.max(bbox.x, bestBlock.bbox.x);
  const y0 = Math.max(bbox.y, bestBlock.bbox.y);
  const x1 = Math.min(bbox.x + bbox.w, bestBlock.bbox.x + bestBlock.bbox.w);
  const y1 = Math.min(bbox.y + bbox.h, bestBlock.bbox.y + bestBlock.bbox.h);

  if (x1 <= x0 || y1 <= y0) return bbox; // degenerate — don't clip

  const clippedW = x1 - x0;
  const clippedH = y1 - y0;

  // Avoid over-aggressive clipping that can make OCR text geometry look cross-column.
  if (clippedW < bbox.w * 0.7 || clippedH < bbox.h * 0.7) {
    return bbox;
  }

  return { x: x0, y: y0, w: clippedW, h: clippedH };
}

/** Block types where text selection should be suppressed */
const NON_TEXT_BLOCK_TYPES = new Set([
  'figure', 'figure_caption', 'table', 'table_caption',
  'table_footnote', 'formula', 'formula_caption', 'abandoned',
]);

/** Block types worth capturing as images */
const CAPTURABLE_TYPES = new Set(['figure', 'table', 'formula']);

export interface OcrTextLayerProps {
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  isInRenderWindow: boolean;
  ocrLines: OcrLineDTO[];
  blocks?: ContentBlockDTO[];
  onBlockClick?: (block: ContentBlockDTO) => void;
  dragBounds?: ColumnBounds[] | undefined;
  onGeometryMismatch?: (pageNumber: number) => void;
}

// ---------------------------------------------------------------------------
// DLA overlay helpers (shared logic with TextLayer)
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
    div.style.pointerEvents = 'auto';
    container.appendChild(div);
  }
}

function maskSpansUnderBlockers(container: HTMLElement): void {
  const blockers = container.querySelectorAll<HTMLElement>('[data-dla-blocker]');
  if (blockers.length === 0) return;

  const blockerRects: DOMRect[] = [];
  for (const b of blockers) blockerRects.push(b.getBoundingClientRect());

  const allSpans = container.querySelectorAll<HTMLElement>('span[data-ocr-line]');
  for (const span of allSpans) {
    const rect = span.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (const bRect of blockerRects) {
      if (cx >= bRect.left && cx <= bRect.right && cy >= bRect.top && cy <= bRect.bottom) {
        span.style.userSelect = 'none';
        (span.style as any).webkitUserSelect = 'none';
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
  requestAnimationFrame(() => maskSpansUnderBlockers(container));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const OcrTextLayer = React.memo(function OcrTextLayer(props: OcrTextLayerProps) {
  const {
    pageNumber,
    cssWidth,
    cssHeight,
    isInRenderWindow,
    ocrLines,
    blocks = [],
    onBlockClick,
    dragBounds,
    onGeometryMismatch,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const blocksRef = useRef<ContentBlockDTO[]>(blocks);
  blocksRef.current = blocks;
  const onBlockClickRef = useRef(onBlockClick);
  onBlockClickRef.current = onBlockClick;

  // ---- Debug visualization toggle ----
  useEffect(() => {
    const win = window as any;
    if (typeof win.__toggleOcrDebug === 'function') return; // already registered

    win.__toggleOcrDebug = () => {
      document.querySelectorAll('.textLayer').forEach((el) => {
        el.classList.toggle('ocr-debug');
      });
      const on = document.querySelector('.textLayer.ocr-debug') != null;
      // eslint-disable-next-line no-console
      console.log(`[OcrTextLayer] debug overlay ${on ? 'ON' : 'OFF'}`);
    };

    return () => { delete win.__toggleOcrDebug; };
  }, []);

  // ---- Effect 1: Render OCR spans (word-level when available, line-level fallback) ----
  useEffect(() => {
    if (!isInRenderWindow) return;
    const container = containerRef.current;
    if (!container) return;
    let rafId: number | null = null;

    // Clear old content
    while (container.firstChild) container.removeChild(container.firstChild);

    // Build text block list for bbox clipping
    const textBlocks = blocksRef.current
      .filter((b) => TEXT_BLOCK_TYPES.has(b.type))
      .map((b) => ({ bbox: b.bbox }));

    // Batch DOM creation with DocumentFragment
    const fragment = document.createDocumentFragment();

    const applySpanStyle = (span: HTMLElement, clipped: NormBBox) => {
      const heightPx = clipped.h * cssHeight;
      span.style.cssText = `position:absolute;left:${clipped.x * cssWidth}px;top:${clipped.y * cssHeight}px;width:${clipped.w * cssWidth}px;height:${heightPx}px;font-size:${heightPx * 0.92}px;line-height:${heightPx}px;font-family:${OCR_FONT_FAMILY};white-space:pre;overflow:hidden;color:transparent;cursor:text;transform-origin:0 0`;
    };

    for (const line of ocrLines) {
      const hasWords = line.words && line.words.length > 0;

      if (hasWords) {
        for (const word of line.words!) {
          const clipped = clipBBoxToBlock(word.bbox, textBlocks);
          const span = document.createElement('span');
          span.setAttribute('data-ocr-line', String(line.lineIndex));
          span.setAttribute('data-ocr-word', '1');
          span.textContent = word.text;
          applySpanStyle(span, clipped);
          fragment.appendChild(span);
        }
      } else {
        const clipped = clipBBoxToBlock(line.bbox, textBlocks);
        const span = document.createElement('span');
        span.setAttribute('data-ocr-line', String(line.lineIndex));
        span.textContent = line.text;
        applySpanStyle(span, clipped);
        fragment.appendChild(span);
      }
    }

    // Add endOfContent sentinel
    const end = document.createElement('div');
    end.className = 'endOfContent';
    fragment.appendChild(end);

    // Single DOM append for all spans
    container.appendChild(fragment);

    // Apply DLA blockers
    applyDLA(container, blocksRef.current, cssWidth, cssHeight);

    // Check OCR geometry alignment in rAF
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const firstLine = ocrLines[0];
      const firstSpan = container.querySelector<HTMLElement>('span[data-ocr-line]');
      if (!onGeometryMismatch || !firstLine || !firstSpan) return;

      const expectedX = firstLine.bbox.x * cssWidth;
      const actualRect = firstSpan.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const actualX = actualRect.left - containerRect.left;

      const xDeviation = Math.abs(actualX - expectedX);
      const deviationRatio = xDeviation / cssWidth;
      if (deviationRatio > 0.03) {
        console.warn(
          `[OcrTextLayer] Page ${pageNumber}: geometry mismatch detected (X deviation: ${deviationRatio.toFixed(2)}). Disabling OCR layer.`,
        );
        onGeometryMismatch(pageNumber);
      }
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isInRenderWindow, ocrLines, blocks, cssWidth, cssHeight]);

  // ---- Effect 2: Re-apply DLA when blocks arrive after render ----
  useEffect(() => {
    if (!isInRenderWindow) return;
    const container = containerRef.current;
    if (!container || container.childElementCount === 0) return;
    if (blocks.length === 0) return;

    applyDLA(container, blocks, cssWidth, cssHeight);
  }, [isInRenderWindow, blocks, cssWidth, cssHeight]);

  // ---- Effect 3: Selection management ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isInRenderWindow) return;

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

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.hasAttribute('data-dla-blocker')) return;
      if (!target.classList.contains('dla-capturable')) return;

      e.stopPropagation();
      e.preventDefault();

      target.classList.toggle('dla-selected');
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

  // ---- Effect 4: DLA drag highlight ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isInRenderWindow) return;

    const blockers = container.querySelectorAll<HTMLElement>('[data-dla-blocker].dla-capturable');
    if (blockers.length === 0) return;

    if (!dragBounds || dragBounds.length === 0) {
      for (const el of blockers) el.classList.remove('dla-drag-highlight');
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

export { OcrTextLayer };
