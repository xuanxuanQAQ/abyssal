/**
 * useMemos -- memo data query & mutation hooks (v2.0)
 *
 * Query Key: ['memos', filterParams]
 * Supports optimistic updates for create/delete.
 * Uses useInfiniteQuery for paginated loading.
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { Memo, NewMemo, MemoFilter, ConceptDraft } from '../../../../shared-types/models';
import { handleError } from '../../errors/errorHandlers';
import { useViewActive } from '../../context/ViewActiveContext';

export function useMemoList(filter: MemoFilter) {
  const viewActive = useViewActive();
  return useInfiniteQuery({
    queryKey: ['memos', filter],
    queryFn: ({ pageParam = 0 }) =>
      getAPI().db.memos.list({ ...filter, offset: pageParam, limit: filter.limit ?? 50 }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const limit = filter.limit ?? 50;
      if (lastPage.length < limit) return undefined;
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
    staleTime: 0,
    enabled: viewActive,
  });
}

export function useMemo(memoId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['memos', 'detail', memoId],
    queryFn: () => getAPI().db.memos.get(memoId!),
    enabled: !!memoId && viewActive,
  });
}

export function useCreateMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memo: NewMemo) => getAPI().db.memos.create(memo),

    onMutate: async (newMemo) => {
      await queryClient.cancelQueries({ queryKey: ['memos'] });

      const optimisticMemo: Memo = {
        id: `temp-${Date.now()}`,
        text: newMemo.text,
        paperIds: newMemo.paperIds ?? [],
        conceptIds: newMemo.conceptIds ?? [],
        annotationId: newMemo.annotationId ?? null,
        outlineId: newMemo.outlineId ?? null,
        linkedNoteIds: [],
        tags: newMemo.tags ?? [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return { optimisticMemo };
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useUpdateMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memoId, patch }: { memoId: string; patch: Partial<Memo> }) =>
      getAPI().db.memos.update(memoId, patch),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useDeleteMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memoId: string) => getAPI().db.memos.delete(memoId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useUpgradeMemoToNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memoId: string) => getAPI().db.memos.upgradeToNote(memoId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useUpgradeMemoToConcept() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memoId, draft }: { memoId: string; draft: ConceptDraft }) =>
      getAPI().db.memos.upgradeToConcept(memoId, draft),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },

    onError: (err) => handleError(err),
  });
}
