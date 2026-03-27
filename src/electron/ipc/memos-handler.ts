/**
 * IPC handler: memos namespace
 *
 * Contract channels: db:memos:list, db:memos:get, db:memos:create,
 *   db:memos:update, db:memos:delete, db:memos:upgradeToNote,
 *   db:memos:upgradeToConcept, db:memos:getByEntity
 *
 * Pushes: push:memo-created on add, push:db-changed on mutations.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asMemoId } from '../../core/types/common';
import type { MemoEntityType } from '../../core/database/dao/memos';
import type { ResearchMemo } from '../../core/types/memo';
import type { Memo } from '../../shared-types/models';

export function registerMemosHandlers(ctx: AppContext): void {
  const { logger, dbProxy } = ctx;

  const MEMO_TABLES = ['research_memos', 'chunks', 'chunks_vec'];

  // ── db:memos:list ──
  typedHandler('db:memos:list', logger, async (_e, filter) => {
    const f = (filter as Record<string, unknown>) ?? {};
    if (f['entityType'] && f['entityId']) {
      return await dbProxy.getMemosByEntity(
        f['entityType'] as MemoEntityType,
        f['entityId'] as string,
      ) as unknown as Memo[];
    }
    return [];
  });

  // ── db:memos:get ──
  typedHandler('db:memos:get', logger, async (_e, memoId) => {
    const memo = await dbProxy.getMemo(asMemoId(memoId));
    if (!memo) throw new Error(`Memo not found: ${memoId}`);
    return memo as unknown as Memo;
  });

  // ── db:memos:create ──
  typedHandler('db:memos:create', logger, async (_e, memo) => {
    const m = memo as unknown as Record<string, unknown>;
    const result = await dbProxy.addMemo(
      {
        text: (m['text'] as string) ?? (m['content'] as string) ?? '',
        paperIds: (m['paperIds'] as string[]) ?? [],
        conceptIds: (m['conceptIds'] as string[]) ?? [],
        annotationId: null,
        outlineId: null,
        linkedNoteIds: [],
        tags: (m['tags'] as string[]) ?? [],
        indexed: false,
      } as unknown as Omit<ResearchMemo, 'id' | 'createdAt' | 'updatedAt'>,
      null,
    );
    ctx.pushManager?.enqueueDbChange(MEMO_TABLES, 'insert');
    ctx.pushManager?.pushMemoCreated({ memoId: (result as unknown as Record<string, unknown>)['memoId'] as string });
    return result as unknown as Memo;
  });

  // ── db:memos:update ──
  typedHandler('db:memos:update', logger, async (_e, memoId, patch) => {
    await dbProxy.updateMemo(asMemoId(memoId), patch as Record<string, unknown>);
    ctx.pushManager?.enqueueDbChange(MEMO_TABLES, 'update');
  });

  // ── db:memos:delete ──
  typedHandler('db:memos:delete', logger, async (_e, memoId) => {
    await dbProxy.deleteMemo(asMemoId(memoId));
    ctx.pushManager?.enqueueDbChange(MEMO_TABLES, 'delete');
  });

  // ── db:memos:upgradeToNote ──
  typedHandler('db:memos:upgradeToNote', logger, async () => {
    // TODO: delegate to dbProxy.upgradeFromMemo(memoId) when implemented
    return { noteId: crypto.randomUUID() };
  });

  // ── db:memos:upgradeToConcept ──
  typedHandler('db:memos:upgradeToConcept', logger, async () => {
    throw new Error('Not implemented');
  });

  // ── db:memos:getByEntity ──
  typedHandler('db:memos:getByEntity', logger, async (_e, entityType, entityId) => {
    return await dbProxy.getMemosByEntity(
      entityType as MemoEntityType,
      entityId,
    ) as unknown as Memo[];
  });
}
