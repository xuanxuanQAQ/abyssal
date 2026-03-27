/**
 * IPC handler: articles namespace
 *
 * Contract channels: db:articles:*, db:sections:*
 * Most are stubs pending articles DAO extension.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerArticlesHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('db:articles:listOutlines', logger, async () => []);

  typedHandler('db:articles:create', logger, async (_e, title) => ({
    id: crypto.randomUUID(),
    title,
    citationStyle: 'GB/T 7714',
    exportFormat: 'markdown',
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sections: [],
  }) as any);

  typedHandler('db:articles:update', logger, async () => {});

  typedHandler('db:articles:getOutline', logger, async (_e, _articleId) => {
    throw new Error('Not implemented');
  });

  typedHandler('db:articles:updateOutlineOrder', logger, async () => {});

  typedHandler('db:articles:getSection', logger, async (_e, _sectionId) => {
    throw new Error('Not implemented');
  });

  typedHandler('db:articles:updateSection', logger, async () => {});

  typedHandler('db:articles:getSectionVersions', logger, async () => []);

  typedHandler('db:articles:search', logger, async () => []);

  typedHandler('db:sections:create', logger, async (_e, _articleId, parentId, sortIndex, title) => ({
    id: crypto.randomUUID(),
    title: title ?? '新节',
    parentId,
    sortIndex,
    status: 'pending',
    wordCount: 0,
    writingInstructions: null,
    aiModel: null,
    children: [],
  }) as any);

  typedHandler('db:sections:delete', logger, async () => {});
}
