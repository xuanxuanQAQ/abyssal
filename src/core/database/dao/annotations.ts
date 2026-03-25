// ═══ 标注 CRUD ═══

import type Database from 'better-sqlite3';
import type { AnnotationId, PaperId, ConceptId } from '../../types/common';
import type { Annotation, AnnotationType } from '../../types/annotation';
import { asAnnotationId } from '../../types/common';
import { now } from '../row-mapper';

// ─── addAnnotation ───

export function addAnnotation(
  db: Database.Database,
  annotation: Omit<Annotation, 'id'>,
): AnnotationId {
  const timestamp = annotation.createdAt || now();

  const result = db.prepare(`
    INSERT INTO annotations (
      paper_id, page, rect_x0, rect_y0, rect_x1, rect_y1,
      selected_text, type, color, comment, concept_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    annotation.paperId,
    annotation.page,
    annotation.rect.x0,
    annotation.rect.y0,
    annotation.rect.x1,
    annotation.rect.y1,
    annotation.selectedText,
    annotation.type,
    annotation.color,
    annotation.comment,
    annotation.conceptId,
    timestamp,
  );

  return asAnnotationId(Number(result.lastInsertRowid));
}

// ─── getAnnotations ───

export function getAnnotations(
  db: Database.Database,
  paperId: PaperId,
): Annotation[] {
  const rows = db
    .prepare('SELECT * FROM annotations WHERE paper_id = ? ORDER BY page, rect_y0')
    .all(paperId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: asAnnotationId(row['id'] as number),
    paperId: row['paper_id'] as PaperId,
    page: row['page'] as number,
    rect: {
      x0: row['rect_x0'] as number,
      y0: row['rect_y0'] as number,
      x1: row['rect_x1'] as number,
      y1: row['rect_y1'] as number,
    },
    selectedText: row['selected_text'] as string,
    type: row['type'] as AnnotationType,
    color: row['color'] as string,
    comment: (row['comment'] as string) ?? null,
    conceptId: (row['concept_id'] as ConceptId) ?? null,
    createdAt: row['created_at'] as string,
  }));
}

// ─── getAnnotation ───

export function getAnnotation(
  db: Database.Database,
  id: AnnotationId,
): Annotation | null {
  const row = db
    .prepare('SELECT * FROM annotations WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: asAnnotationId(row['id'] as number),
    paperId: row['paper_id'] as PaperId,
    page: row['page'] as number,
    rect: {
      x0: row['rect_x0'] as number,
      y0: row['rect_y0'] as number,
      x1: row['rect_x1'] as number,
      y1: row['rect_y1'] as number,
    },
    selectedText: row['selected_text'] as string,
    type: row['type'] as AnnotationType,
    color: row['color'] as string,
    comment: (row['comment'] as string) ?? null,
    conceptId: (row['concept_id'] as ConceptId) ?? null,
    createdAt: row['created_at'] as string,
  };
}

// ─── deleteAnnotation ───

export function deleteAnnotation(
  db: Database.Database,
  id: AnnotationId,
): number {
  return db.prepare('DELETE FROM annotations WHERE id = ?').run(id).changes;
}

// ─── getAnnotationsByConceptId ───

export function getAnnotationsByConcept(
  db: Database.Database,
  conceptId: ConceptId,
): Annotation[] {
  const rows = db
    .prepare('SELECT * FROM annotations WHERE concept_id = ? ORDER BY created_at')
    .all(conceptId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: asAnnotationId(row['id'] as number),
    paperId: row['paper_id'] as PaperId,
    page: row['page'] as number,
    rect: {
      x0: row['rect_x0'] as number,
      y0: row['rect_y0'] as number,
      x1: row['rect_x1'] as number,
      y1: row['rect_y1'] as number,
    },
    selectedText: row['selected_text'] as string,
    type: row['type'] as AnnotationType,
    color: row['color'] as string,
    comment: (row['comment'] as string) ?? null,
    conceptId: (row['concept_id'] as ConceptId) ?? null,
    createdAt: row['created_at'] as string,
  }));
}
