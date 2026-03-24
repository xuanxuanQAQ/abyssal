/**
 * useTags — 标签 CRUD hooks
 *
 * Query Key: ['tags', 'list']
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { Tag } from '../../../../shared-types/models';
import { handleError } from '../../errors/errorHandlers';

export function useTagList() {
  return useQuery({
    queryKey: ['tags', 'list'],
    queryFn: () => getAPI().db.tags.list(),
    staleTime: 30_000,
    gcTime: 300_000,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      getAPI().db.tags.create(name, parentId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Tag> }) =>
      getAPI().db.tags.update(id, patch),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getAPI().db.tags.delete(id),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },

    onError: (err) => handleError(err),
  });
}
