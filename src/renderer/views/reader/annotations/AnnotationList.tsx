import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnnotations, useDeleteAnnotation, useUpdateAnnotation } from '../../../core/ipc/hooks/useAnnotations';
import { AnnotationCard } from './AnnotationCard';
import type { Annotation } from '../../../../shared-types/models';
import type { HighlightColor } from '../../../../shared-types/enums';

export function AnnotationList({
  paperId,
  onScrollToAnnotation,
}: {
  paperId: string | null;
  onScrollToAnnotation: (page: number, annotationId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: annotations = [] } = useAnnotations(paperId);
  const deleteAnnotation = useDeleteAnnotation();
  const updateAnnotation = useUpdateAnnotation();

  const handleDelete = useCallback(
    (annotationId: string) => {
      if (!paperId) return;
      deleteAnnotation.mutate({ id: annotationId, paperId });
    },
    [paperId, deleteAnnotation]
  );

  const handleUpdateColor = useCallback(
    (annotationId: string, color: HighlightColor) => {
      if (!paperId) return;
      updateAnnotation.mutate({ id: annotationId, patch: { color }, paperId });
    },
    [paperId, updateAnnotation]
  );

  const grouped = useMemo(() => {
    if (!annotations || annotations.length === 0) return [];

    const groups = new Map<number, Annotation[]>();
    for (const ann of annotations) {
      const page = ann.page;
      const existing = groups.get(page);
      if (existing) {
        existing.push(ann);
      } else {
        groups.set(page, [ann]);
      }
    }

    const sortedPages = Array.from(groups.keys()).sort((a, b) => a - b);

    return sortedPages.map((page) => {
      const items = groups.get(page)!;
      items.sort((a, b) => {
        const aY = a.position.rects.length > 0 ? (a.position.rects[0]?.y ?? 0) : 0;
        const bY = b.position.rects.length > 0 ? (b.position.rects[0]?.y ?? 0) : 0;
        return aY - bY;
      });
      return { page, items };
    });
  }, [annotations]);

  const counts = useMemo(() => {
    if (!annotations) return { total: 0, highlights: 0, notes: 0, concepts: 0 };
    let highlights = 0;
    let notes = 0;
    let concepts = 0;
    for (const ann of annotations) {
      if (ann.type === 'highlight') highlights++;
      else if (ann.type === 'note') notes++;
      else if (ann.type === 'conceptTag') concepts++;
    }
    return { total: annotations.length, highlights, notes, concepts };
  }, [annotations]);

  if (paperId === null || !annotations || annotations.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {t('reader.annotations.noAnnotations')}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Statistics line */}
      <div
        style={{
          padding: '8px 12px',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {t('reader.annotations.total')} {counts.total} (🟡 {counts.highlights} 📝 {counts.notes} 🏷 {counts.concepts})
      </div>

      {/* Grouped annotation list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8 }}>
        {grouped.map((group) => (
          <div key={group.page}>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--text-muted)',
                padding: '8px 4px 4px',
                textTransform: 'uppercase',
              }}
            >
              {t('reader.annotations.page', { page: group.page })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {group.items.map((annotation) => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onClick={() => onScrollToAnnotation(group.page, annotation.id)}
                  onDelete={() => handleDelete(annotation.id)}
                  onUpdateColor={(color: HighlightColor) => handleUpdateColor(annotation.id, color)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
