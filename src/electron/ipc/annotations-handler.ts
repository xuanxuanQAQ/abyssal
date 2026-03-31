/**
 * IPC handler: annotations namespace
 *
 * Contract channels: db:annotations:listForPaper, db:annotations:create,
 *   db:annotations:update, db:annotations:delete
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asPaperId, asConceptId, asAnnotationId } from '../../core/types/common';
import type { PdfRect } from '../../core/types/annotation';
import type { Annotation } from '../../shared-types/models';

export function registerAnnotationsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── db:annotations:listForPaper ──
  typedHandler('db:annotations:listForPaper', logger, async (_e, paperId) => {
    const rows = await ctx.dbProxy.getAnnotations(asPaperId(paperId)) as unknown as Array<Record<string, unknown>>;
    return rows.map(backendAnnotationToFrontend) as unknown as Annotation[];
  });

  // ── db:annotations:create ──
  typedHandler('db:annotations:create', logger, async (_e, annotation) => {
    const a = annotation as Record<string, unknown>;

    // Frontend sends AnnotationPosition { rects: [{x,y,width,height},...], pageWidth, pageHeight }
    // Backend DAO stores a single rect as (x0, y0, x1, y1)
    let pdfRect: PdfRect = { x0: 0, y0: 0, x1: 0, y1: 0 };

    const position = a['position'] as Record<string, unknown> | undefined;
    if (position) {
      const rects = position['rects'] as Array<Record<string, number>> | undefined;
      if (rects && rects.length > 0) {
        // Compute bounding box across all rects
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const r of rects) {
          const rx = r['x'] ?? 0;
          const ry = r['y'] ?? 0;
          const rw = r['width'] ?? 0;
          const rh = r['height'] ?? 0;
          minX = Math.min(minX, rx);
          minY = Math.min(minY, ry);
          maxX = Math.max(maxX, rx + rw);
          maxY = Math.max(maxY, ry + rh);
        }
        pdfRect = { x0: minX, y0: minY, x1: maxX, y1: maxY };
      }
    } else {
      // Legacy fallback: direct rect field
      const rect = a['rect'] as Record<string, number> | undefined;
      if (rect) {
        pdfRect = {
          x0: rect['x0'] ?? rect['x'] ?? 0,
          y0: rect['y0'] ?? rect['y'] ?? 0,
          x1: rect['x1'] ?? ((rect['x'] ?? 0) + (rect['width'] ?? 0)),
          y1: rect['y1'] ?? ((rect['y'] ?? 0) + (rect['height'] ?? 0)),
        };
      }
    }

    const result = await ctx.dbProxy.addAnnotation({
      paperId: asPaperId(a['paperId'] as string),
      type: a['type'] as 'highlight' | 'note' | 'conceptTag',
      page: ((a['pageNumber'] ?? a['page']) as number) || 0,
      rect: pdfRect,
      selectedText: (a['selectedText'] as string) ?? '',
      color: (a['color'] as string) ?? '#FFEB3B',
      comment: ((a['comment'] ?? a['text'] ?? a['content']) as string) ?? null,
      conceptId: a['conceptId'] ? asConceptId(a['conceptId'] as string) : null,
      createdAt: new Date().toISOString(),
    });
    ctx.pushManager?.enqueueDbChange(['annotations'], 'insert');

    // addAnnotation returns AnnotationId; fetch full annotation and map back to frontend shape
    const created = await ctx.dbProxy.getAnnotation(result) as Record<string, unknown> | null;
    if (!created) {
      return { ...a, id: String(result) } as unknown as Annotation;
    }

    // Map backend rect (x0,y0,x1,y1) back to frontend AnnotationPosition
    return backendAnnotationToFrontend(created) as unknown as Annotation;
  });

  // ── db:annotations:update ──
  typedHandler('db:annotations:update', logger, async (_e, id, patch) => {
    const p = patch as Record<string, unknown>;
    const updatePatch: Record<string, unknown> = {};

    if (p['color'] !== undefined) updatePatch['color'] = p['color'] as string;
    if (p['comment'] !== undefined) updatePatch['comment'] = (p['comment'] as string | null);
    if (p['conceptId'] !== undefined) {
      updatePatch['conceptId'] = p['conceptId'] ? asConceptId(p['conceptId'] as string) : null;
    }
    if (p['type'] !== undefined) updatePatch['type'] = p['type'] as string;

    await ctx.dbProxy.updateAnnotation(asAnnotationId(Number(id)), updatePatch);
    ctx.pushManager?.enqueueDbChange(['annotations'], 'update');
  });

  // ── db:annotations:delete ──
  typedHandler('db:annotations:delete', logger, async (_e, id) => {
    await ctx.dbProxy.deleteAnnotation(asAnnotationId(Number(id)));
    ctx.pushManager?.enqueueDbChange(['annotations'], 'delete');
  });
}

// ── Backend → Frontend annotation mapping ──

/**
 * Convert backend annotation (single rect x0/y0/x1/y1)
 * to frontend Annotation shape (position.rects array with x/y/width/height).
 */
function backendAnnotationToFrontend(row: Record<string, unknown>): Record<string, unknown> {
  const rect = row['rect'] as Record<string, number> | undefined;
  const x0 = rect?.['x0'] ?? (row['rect_x0'] as number) ?? 0;
  const y0 = rect?.['y0'] ?? (row['rect_y0'] as number) ?? 0;
  const x1 = rect?.['x1'] ?? (row['rect_x1'] as number) ?? 0;
  const y1 = rect?.['y1'] ?? (row['rect_y1'] as number) ?? 0;

  return {
    id: String(row['id']),
    paperId: String(row['paperId'] ?? row['paper_id'] ?? ''),
    type: (row['type'] ?? 'highlight') as string,
    page: (row['page'] ?? 0) as number,
    position: {
      rects: [{
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      }],
      pageWidth: 0, // populated if available
      pageHeight: 0,
      coordinateSystem: 'pdf_points',
    },
    color: (row['color'] ?? 'yellow') as string,
    text: (row['comment'] ?? null) as string | null,
    conceptId: (row['conceptId'] ?? row['concept_id'] ?? null) as string | null,
    selectedText: (row['selectedText'] ?? row['selected_text'] ?? '') as string,
    groupId: null,
  };
}
