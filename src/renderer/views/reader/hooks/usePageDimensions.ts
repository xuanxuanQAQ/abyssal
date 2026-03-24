import { useMemo } from 'react';
import type { PageMetadata } from '../core/pageMetadataPreloader';

export interface PageDimensions {
  cssWidth: number;
  cssHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
}

export function usePageDimensions(
  metadata: PageMetadata | undefined,
  scale: number,
): PageDimensions | null {
  return useMemo(() => {
    if (metadata === undefined) {
      return null;
    }

    const cssWidth = metadata.baseWidth * scale;
    const cssHeight = metadata.baseHeight * scale;
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.floor(cssWidth * dpr);
    const canvasHeight = Math.floor(cssHeight * dpr);

    return {
      cssWidth,
      cssHeight,
      canvasWidth,
      canvasHeight,
      dpr,
    };
  }, [metadata, scale]);
}
