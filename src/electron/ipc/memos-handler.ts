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
import { asMemoId, asNoteId } from '../../core/types/common';
import type { MemoEntityType } from '../../core/database/dao/memos';
import type { ResearchMemo } from '../../core/types/memo';
import type { ResearchNote } from '../../core/types/note';
import type { Memo, MemoFilter } from '../../shared-types/models';
import { createConceptFromDraft } from './shared/create-concept';

/** Convert backend ResearchMemo to frontend Memo shape */
function memoToFrontend(m: ResearchMemo): Memo {
  return {
    id: String(m.id),
    text: m.text,
    paperIds: m.paperIds,
    conceptIds: m.conceptIds,
    annotationId: m.annotationId ? String(m.annotationId) : null,
    outlineId: m.outlineId ? String(m.outlineId) : null,
    linkedNoteIds: m.linkedNoteIds,
    tags: m.tags,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export function registerMemosHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  const MEMO_TABLES = ['research_memos', 'chunks', 'chunks_vec'];

  // ── db:memos:list ──
  typedHandler('db:memos:list', logger, async (_e, filter) => {
    const f = (filter as MemoFilter | undefined) ?? {};

    // Legacy entity-based query path
    if ((f as Record<string, unknown>)['entityType'] && (f as Record<string, unknown>)['entityId']) {
      const memos = await ctx.dbProxy.getMemosByEntity(
        (f as Record<string, unknown>)['entityType'] as MemoEntityType,
        (f as Record<string, unknown>)['entityId'] as string,
      ) as unknown as ResearchMemo[];
      return memos.map(memoToFrontend);
    }

    // Full filter-based query
    const queryFilter: Record<string, unknown> = {};
    if (f.paperIds) queryFilter['paperIds'] = f.paperIds;
    if (f.conceptIds) queryFilter['conceptIds'] = f.conceptIds;
    if (f.tags) queryFilter['tags'] = f.tags;
    if (f.searchText) queryFilter['searchText'] = f.searchText;
    if (f.limit != null) queryFilter['limit'] = f.limit;
    if (f.offset != null) queryFilter['offset'] = f.offset;
    const memos = await ctx.dbProxy.queryMemos(queryFilter as Parameters<typeof ctx.dbProxy.queryMemos>[0]) as unknown as ResearchMemo[];
    return memos.map(memoToFrontend);
  });

  // ── db:memos:get ──
  typedHandler('db:memos:get', logger, async (_e, memoId) => {
    const memo = await ctx.dbProxy.getMemo(asMemoId(memoId)) as unknown as ResearchMemo | null;
    if (!memo) throw new Error(`Memo not found: ${memoId}`);
    return memoToFrontend(memo);
  });

  // ── db:memos:create ──
  typedHandler('db:memos:create', logger, async (_e, memo) => {
    const m = memo as unknown as Record<string, unknown>;
    const result = await ctx.dbProxy.addMemo(
      {
        text: (m['text'] as string) ?? (m['content'] as string) ?? '',
        paperIds: (m['paperIds'] as string[]) ?? [],
        conceptIds: (m['conceptIds'] as string[]) ?? [],
        annotationId: (m['annotationId'] as string) ?? null,
        outlineId: (m['outlineId'] as string) ?? null,
        linkedNoteIds: [],
        tags: (m['tags'] as string[]) ?? [],
        indexed: false,
      } as unknown as Omit<ResearchMemo, 'id' | 'createdAt' | 'updatedAt'>,
      null,
    );
    ctx.pushManager?.enqueueDbChange(MEMO_TABLES, 'insert');

    const memoId = (result as unknown as Record<string, unknown>)['memoId'] as string;
    ctx.pushManager?.pushMemoCreated({ memoId });

    // Fetch and return full memo
    const created = await ctx.dbProxy.getMemo(asMemoId(memoId)) as unknown as ResearchMemo | null;
    if (created) return memoToFrontend(created);
    return result as unknown as Memo;
  });

  // ── db:memos:update ──
  typedHandler('db:memos:update', logger, async (_e, memoId, patch) => {
    await ctx.dbProxy.updateMemo(asMemoId(memoId), patch as Record<string, unknown>);
    ctx.pushManager?.enqueueDbChange(MEMO_TABLES, 'update');
  });

  // ── db:memos:delete ──
  typedHandler('db:memos:delete', logger, async (_e, memoId) => {
    await ctx.dbProxy.deleteMemo(asMemoId(memoId));
    ctx.pushManager?.enqueueDbChange(MEMO_TABLES, 'delete');
  });

  // ── db:memos:upgradeToNote ──
  typedHandler('db:memos:upgradeToNote', logger, async (_e, memoId) => {
    const mid = asMemoId(memoId);
    const memo = await ctx.dbProxy.getMemo(mid) as unknown as ResearchMemo | null;
    if (!memo) throw new Error(`Memo not found: ${memoId}`);

    // Create a new note with memo content
    const noteId = asNoteId(crypto.randomUUID());
    const title = memo.text.slice(0, 60).replace(/\n/g, ' ').trim() || 'Untitled Note';

    // Build ProseMirror JSON from memo text
    const paragraphs = memo.text.split(/\n{2,}/).filter((p) => p.trim());
    const docContent = paragraphs.length > 0
      ? paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))
      : [{ type: 'paragraph' }];
    const documentJson = JSON.stringify({ type: 'doc', content: docContent });

    // Create note in DB
    await ctx.dbProxy.createNote(
      {
        id: noteId,
        title,
        filePath: '',
        linkedPaperIds: memo.paperIds,
        linkedConceptIds: memo.conceptIds,
        tags: memo.tags,
        documentJson,
      } as unknown as Omit<ResearchNote, 'createdAt' | 'updatedAt'>,
      [],
      [],
    );

    // Link memo to the new note
    await ctx.dbProxy.linkMemoToNote(mid, noteId);

    ctx.pushManager?.enqueueDbChange([...MEMO_TABLES, 'research_notes'], 'insert');
    return { noteId: String(noteId) };
  });

  // ── db:memos:upgradeToConcept ──
  typedHandler('db:memos:upgradeToConcept', logger, async (_e, memoId, draft) => {
    const mid = asMemoId(memoId);
    const memo = await ctx.dbProxy.getMemo(mid) as unknown as ResearchMemo | null;
    if (!memo) throw new Error(`Memo not found: ${memoId}`);

    const d = draft as unknown as Record<string, unknown>;
    const conceptId = await createConceptFromDraft(ctx.dbProxy, d, memo.text.slice(0, 500));

    // Link the memo to the newly created concept
    await ctx.dbProxy.updateMemo(mid, { conceptIds: [...memo.conceptIds, conceptId] } as Record<string, unknown>);

    ctx.pushManager?.enqueueDbChange([...MEMO_TABLES, 'concepts'], 'insert');
  });

  // ── db:memos:getByEntity ──
  typedHandler('db:memos:getByEntity', logger, async (_e, entityType, entityId) => {
    const memos = await ctx.dbProxy.getMemosByEntity(
      entityType as MemoEntityType,
      entityId,
    ) as unknown as ResearchMemo[];
    return memos.map(memoToFrontend);
  });
}
