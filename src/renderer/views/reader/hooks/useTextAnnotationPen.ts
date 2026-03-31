import { useCallback, useState } from 'react';
import type { AnnotationPosition } from '../../../../shared-types/models';

interface PendingPosition {
  page: number;
  position: AnnotationPosition;
  selectedText: string;
}

export interface TextAnnotationPenState {
  pendingNotePosition: PendingPosition | null;
  pendingConceptPosition: PendingPosition | null;
  clearPending: () => void;
}

export function useTextAnnotationPen(): TextAnnotationPenState {
  const [pendingNotePosition, setPendingNotePosition] =
    useState<PendingPosition | null>(null);
  const [pendingConceptPosition, setPendingConceptPosition] =
    useState<PendingPosition | null>(null);

  const clearPending = useCallback((): void => {
    setPendingNotePosition(null);
    setPendingConceptPosition(null);
  }, []);

  // Acrobat-style: SelectionToolbar in PDFViewport handles all annotation
  // creation. This hook only manages pending note/concept state.

  return {
    pendingNotePosition,
    pendingConceptPosition,
    clearPending,
  };
}
