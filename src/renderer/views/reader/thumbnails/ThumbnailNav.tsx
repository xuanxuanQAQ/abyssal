import React, { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useReaderStore } from '../../../core/store/useReaderStore';
import { ThumbnailItem } from './ThumbnailItem';
import type { PageMetadataMap } from '../core/pageMetadataPreloader';
import type { Annotation } from '../../../../shared-types/models';

const THUMB_WIDTH = 60;
const THUMB_GAP = 8;

import { HIGHLIGHT_COLOR_MAP as ANNOTATION_COLOR_MAP } from '../shared/highlightColors';

export interface ThumbnailNavProps {
  pageMetadataMap: PageMetadataMap;
  annotations: Annotation[];
  onScrollToPage: (pageNumber: number) => void;
  renderThumbnail: (canvas: HTMLCanvasElement, pageNumber: number) => { promise: Promise<void>; cancel: () => void };
}

export function ThumbnailNav({
  pageMetadataMap,
  annotations,
  onScrollToPage,
  renderThumbnail,
}: ThumbnailNavProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const totalPages = useReaderStore((s) => s.totalPages);
  const currentPage = useReaderStore((s) => s.currentPage);

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const ann of annotations) {
      const page = (ann as Annotation & { page: number }).page;
      if (page == null) continue;
      const existing = map.get(page);
      if (existing) {
        existing.push(ann);
      } else {
        map.set(page, [ann]);
      }
    }
    return map;
  }, [annotations]);

  const estimateSize = useCallback(
    (index: number) => {
      const pageNumber = index + 1;
      const meta = pageMetadataMap.get(pageNumber);
      if (meta) {
        return (meta.baseHeight / meta.baseWidth) * THUMB_WIDTH + THUMB_GAP;
      }
      return 85 + THUMB_GAP;
    },
    [pageMetadataMap],
  );

  const virtualizer = useVirtualizer({
    count: totalPages,
    getScrollElement: () => containerRef.current,
    estimateSize,
    overscan: 5,
  });

  const handleClick = useCallback(
    (pageNumber: number) => {
      onScrollToPage(pageNumber);
    },
    [onScrollToPage],
  );

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: 10,
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const pageNumber = virtualItem.index + 1;
          const meta = pageMetadataMap.get(pageNumber);
          const thumbHeight = meta
            ? (meta.baseHeight / meta.baseWidth) * THUMB_WIDTH
            : 85;

          const pageAnnotations = annotationsByPage.get(pageNumber);
          const hasAnnotations = pageAnnotations != null && pageAnnotations.length > 0;

          let annotationColor: string | null = null;
          if (hasAnnotations && pageAnnotations != null) {
            const firstAnn = pageAnnotations[0] as Annotation & { color?: string };
            const rawColor = firstAnn.color;
            if (rawColor != null) {
              annotationColor = ANNOTATION_COLOR_MAP[rawColor] ?? rawColor;
            }
          }

          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`,
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <ThumbnailItem
                pageNumber={pageNumber}
                thumbWidth={THUMB_WIDTH}
                thumbHeight={thumbHeight}
                isCurrent={pageNumber === currentPage}
                hasAnnotations={hasAnnotations}
                annotationColor={annotationColor}
                renderThumbnail={renderThumbnail}
                onClick={handleClick}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
