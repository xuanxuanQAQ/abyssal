import React, { useRef, useEffect } from 'react';
import { TextLayer as PDFJSTextLayer } from 'pdfjs-dist';
import { useReaderStore } from '../../../../core/store/useReaderStore';
import './pdfTextLayer.css';

export interface TextLayerProps {
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  scale: number;
  getPage: (pageNumber: number) => Promise<any>;
  isInRenderWindow: boolean;
}

/**
 * Transparent text DOM layer (z-index: 1) for native text selection.
 */
const TextLayer = React.memo(function TextLayer(props: TextLayerProps) {
  const { pageNumber, cssWidth, cssHeight, scale, getPage, isInRenderWindow } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);

  useEffect(() => {
    if (!isInRenderWindow) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;

    const renderTextLayer = async () => {
      // Cleanup old text layer content
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }

      const page = await getPage(pageNumber);
      if (cancelled) return;

      const textContent = await page.getTextContent();
      if (cancelled) return;

      const viewport = page.getViewport({ scale });

      // pdf.js v4.x uses CSS custom property --scale-factor for span positioning
      // and container sizing. Must be set before constructing PDFJSTextLayer.
      container.style.setProperty('--scale-factor', String(scale));

      console.log(`[TextLayer] page=${pageNumber}`, {
        scale,
        scaleFactor: scale,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        cssWidth,
        cssHeight,
      });

      const textLayer = new PDFJSTextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });

      await textLayer.render();

      // Log first span to verify alignment
      const spans = container.querySelectorAll('span');
      if (spans.length > 0) {
        const s = spans[0]!;
        const cs = getComputedStyle(s);
        console.log(`[TextLayer] first span:`, {
          fontSize: cs.fontSize,
          left: cs.left,
          top: cs.top,
          text: s.textContent?.slice(0, 30),
        });
      }
    };

    renderTextLayer();

    return () => {
      cancelled = true;
    };
  }, [isInRenderWindow, pageNumber, scale, getPage]);

  if (!isInRenderWindow) {
    return null;
  }

  // Determine pointer-events based on active annotation tool
  let pointerEvents: React.CSSProperties['pointerEvents'];
  if (activeAnnotationTool === 'areaHighlight' || activeAnnotationTool === 'hand') {
    pointerEvents = 'none';
  } else {
    // null, textHighlight, textNote, textConceptTag → auto (selection works)
    pointerEvents = 'auto';
  }

  return (
    <div
      ref={containerRef}
      data-page={pageNumber}
      className="textLayer"
      style={{
        pointerEvents,
      }}
    />
  );
});

export { TextLayer };
