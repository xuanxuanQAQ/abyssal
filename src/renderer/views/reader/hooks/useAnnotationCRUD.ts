import { useCallback } from 'react';
import {
  useCreateAnnotation,
  useUpdateAnnotation,
  useDeleteAnnotation,
} from '../../../core/ipc/hooks/useAnnotations';
import type { NewAnnotation, Annotation } from '../../../../shared-types/models';
import type { AnnotationPosition } from '../../../../shared-types/models';
import type { HighlightColor, AnnotationType } from '../../../../shared-types/enums';
import { generateGroupId } from '../selection/crossPageDetection';

export function useAnnotationCRUD(paperId: string | null) {
  const createAnnotationMutation = useCreateAnnotation();
  const updateAnnotationMutation = useUpdateAnnotation();
  const deleteAnnotationMutation = useDeleteAnnotation();

  const createHighlight = useCallback(
    (
      page: number,
      position: AnnotationPosition,
      selectedText: string,
      color: HighlightColor,
    ): void => {
      if (!paperId) return;

      const annotation: NewAnnotation = {
        paperId,
        type: 'highlight' as AnnotationType,
        page,
        position,
        color,
        text: null,
        conceptId: null,
        selectedText,
        groupId: null,
        pdfSyncStatus: undefined,
      };

      createAnnotationMutation.mutate({ annotation, paperId });
    },
    [paperId, createAnnotationMutation],
  );

  const createNote = useCallback(
    (
      page: number,
      position: AnnotationPosition,
      selectedText: string,
      color: HighlightColor,
      text: string,
    ): void => {
      if (!paperId) return;

      const annotation: NewAnnotation = {
        paperId,
        type: 'note' as AnnotationType,
        page,
        position,
        color,
        text,
        conceptId: null,
        selectedText,
        groupId: null,
        pdfSyncStatus: undefined,
      };

      createAnnotationMutation.mutate({ annotation, paperId });
    },
    [paperId, createAnnotationMutation],
  );

  const createConceptTag = useCallback(
    (
      page: number,
      position: AnnotationPosition,
      selectedText: string,
      color: HighlightColor,
      conceptId: string,
    ): void => {
      if (!paperId) return;

      const annotation: NewAnnotation = {
        paperId,
        type: 'conceptTag' as AnnotationType,
        page,
        position,
        color,
        text: null,
        conceptId,
        selectedText,
        groupId: null,
        pdfSyncStatus: undefined,
      };

      createAnnotationMutation.mutate({ annotation, paperId });
    },
    [paperId, createAnnotationMutation],
  );

  const createCrossPageAnnotations = useCallback(
    (
      pages: Array<{
        page: number;
        position: AnnotationPosition;
        selectedText: string;
      }>,
      type: AnnotationType,
      color: HighlightColor,
    ): void => {
      if (!paperId) return;

      const groupId = generateGroupId();

      for (const entry of pages) {
        const annotation: NewAnnotation = {
          paperId,
          type,
          page: entry.page,
          position: entry.position,
          color,
          text: null,
          conceptId: null,
          selectedText: entry.selectedText,
          groupId,
          pdfSyncStatus: undefined,
        };

        createAnnotationMutation.mutate({ annotation, paperId });
      }
    },
    [paperId, createAnnotationMutation],
  );

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>): void => {
      updateAnnotationMutation.mutate({ id, patch, paperId: paperId! });
    },
    [updateAnnotationMutation, paperId],
  );

  const deleteAnnotation = useCallback(
    (id: string): void => {
      deleteAnnotationMutation.mutate({ id, paperId: paperId! });
    },
    [deleteAnnotationMutation, paperId],
  );

  const deleteAnnotationGroup = useCallback(
    (groupId: string, annotations: Annotation[]): void => {
      const groupAnnotations = annotations.filter(
        (a) => a.groupId === groupId,
      );
      for (const annotation of groupAnnotations) {
        deleteAnnotationMutation.mutate({ id: annotation.id, paperId: paperId! });
      }
    },
    [deleteAnnotationMutation, paperId],
  );

  return {
    createHighlight,
    createNote,
    createConceptTag,
    createCrossPageAnnotations,
    updateAnnotation,
    deleteAnnotation,
    deleteAnnotationGroup,
  };
}
