/**
 * IPC handler: tags namespace
 *
 * Contract channels: db:tags:list, db:tags:create, db:tags:update, db:tags:delete
 *
 * Stub implementation — tags are not yet backed by a dedicated DAO.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerTagsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('db:tags:list', logger, async () => []);

  typedHandler('db:tags:create', logger, async (_e, name, parentId?) => ({
    id: crypto.randomUUID(),
    name,
    parentId: parentId ?? null,
    paperCount: 0,
    color: null,
  }) as any);

  typedHandler('db:tags:update', logger, async () => {});

  typedHandler('db:tags:delete', logger, async () => {});
}
