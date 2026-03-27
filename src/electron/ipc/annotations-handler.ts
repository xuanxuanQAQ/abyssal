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
  const { logger, dbProxy } = ctx;

  // ── db:annotations:listForPaper ──
  typedHandler('db:annotations:listForPaper', logger, async (_e, paperId) => {
    return await dbProxy.getAnnotations(asPaperId(paperId)) as unknown as Annotation[];
  });

  // ── db:annotations:create ──
  typedHandler('db:annotations:create', logger, async (_e, annotation) => {
    const a = annotation as Record<string, unknown>;
    const rect = a['rect'] as Record<string, number> | undefined;
    const result = await dbProxy.addAnnotation({
      paperId: asPaperId(a['paperId'] as string),
      type: a['type'] as 'highlight' | 'note' | 'concept_tag',
      page: ((a['pageNumber'] ?? a['page']) as number) || 0,
      rect: rect
        ? ({ x0: rect['x0'] ?? rect['x'] ?? 0, y0: rect['y0'] ?? rect['y'] ?? 0, x1: rect['x1'] ?? ((rect['x'] ?? 0) + (rect['width'] ?? 0)), y1: rect['y1'] ?? ((rect['y'] ?? 0) + (rect['height'] ?? 0)) } as PdfRect)
        : { x0: 0, y0: 0, x1: 0, y1: 0 },
      selectedText: (a['selectedText'] as string) ?? '',
      color: (a['color'] as string) ?? '#FFEB3B',
      comment: ((a['comment'] as string) ?? (a['content'] as string)) ?? null,
      conceptId: a['conceptId'] ? asConceptId(a['conceptId'] as string) : null,
      createdAt: new Date().toISOString(),
    });
    ctx.pushManager?.enqueueDbChange(['annotations'], 'insert');
    // addAnnotation returns AnnotationId; fetch full annotation for contract
    const created = await dbProxy.getAnnotation(result);
    return created as unknown as Annotation;
  });

  // ── db:annotations:update ──
  typedHandler('db:annotations:update', logger, async () => {
    // TODO: DatabaseService has no updateAnnotation method yet
  });

  // ── db:annotations:delete ──
  typedHandler('db:annotations:delete', logger, async (_e, id) => {
    await dbProxy.deleteAnnotation(asAnnotationId(Number(id)));
    ctx.pushManager?.enqueueDbChange(['annotations'], 'delete');
  });
}
