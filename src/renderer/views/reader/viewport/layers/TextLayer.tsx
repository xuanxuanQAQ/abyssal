import React, { useRef, useEffect } from 'react';
import { TextLayer as PDFJSTextLayer } from 'pdfjs-dist';
import { useReaderStore } from '../../../../core/store/useReaderStore';

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

      const textLayer = new PDFJSTextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });

      await textLayer.render();
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
  if (activeAnnotationTool === 'areaHighlight') {
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
        position: 'absolute',
        left: 0,
        top: 0,
        width: cssWidth,
        height: cssHeight,
        color: 'transparent',
        lineHeight: 1,
        opacity: 0.25,
        pointerEvents,
        zIndex: 1,
      }}
    />
  );
});

export { TextLayer };
