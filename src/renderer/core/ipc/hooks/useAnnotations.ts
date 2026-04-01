/**
 * useAnnotations — 标注 CRUD hooks
 *
 * Query Key: ['annotations', paperId]
 * 创建/更新/删除操作遵循三步竞态安全协议
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { Annotation, NewAnnotation } from '../../../../shared-types/models';
import { handleError } from '../../errors/errorHandlers';
import { useViewActive } from '../../context/ViewActiveContext';

export function useAnnotations(paperId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['annotations', paperId],
    queryFn: () => getAPI().db.annotations.listForPaper(paperId!),
    enabled: paperId !== null && viewActive,
    staleTime: 0,
    gcTime: 300_000,
  });
}

export function useCreateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      annotation,
    }: {
      annotation: NewAnnotation;
      paperId: string;
    }) => getAPI().db.annotations.create(annotation),

    onMutate: async ({ annotation, paperId }) => {
      await queryClient.cancelQueries({
        queryKey: ['annotations', paperId],
      });

      const previousAnnotations = queryClient.getQueryData<Annotation[]>([
        'annotations',
        paperId,
      ]);

      // 使用临时 ID 乐观插入
      const tempAnnotation: Annotation = {
        ...annotation,
        id: `temp-${Date.now()}`,
      };

      queryClient.setQueryData<Annotation[]>(
        ['annotations', paperId],
        (old) => [...(old ?? []), tempAnnotation]
      );

      return { previousAnnotations, paperId };
    },

    onSuccess: (createdAnnotation, { paperId }) => {
      // 用服务端返回的真实 ID 替换临时 ID
      queryClient.setQueryData<Annotation[]>(
        ['annotations', paperId],
        (old) =>
          old?.map((a) =>
            a.id.startsWith('temp-') ? createdAnnotation : a
          ) ?? [createdAnnotation]
      );
    },

    onError: (_err, { paperId }, context) => {
      if (context?.previousAnnotations) {
        queryClient.setQueryData(
          ['annotations', paperId],
          context.previousAnnotations
        );
      }
      handleError(_err);
    },

    onSettled: (_data, _err, { paperId }) => {
      queryClient.invalidateQueries({ queryKey: ['annotations', paperId] });
    },
  });
}

export function useUpdateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Annotation>;
      paperId: string;
    }) => getAPI().db.annotations.update(id, patch),

    onMutate: async ({ id, patch, paperId }) => {
      await queryClient.cancelQueries({
        queryKey: ['annotations', paperId],
      });

      const previousAnnotations = queryClient.getQueryData<Annotation[]>([
        'annotations',
        paperId,
      ]);

      if (previousAnnotations) {
        queryClient.setQueryData<Annotation[]>(
          ['annotations', paperId],
          previousAnnotations.map((a) =>
            a.id === id ? { ...a, ...patch } : a
          )
        );
      }

      return { previousAnnotations, paperId };
    },

    onError: (_err, { paperId }, context) => {
      if (context?.previousAnnotations) {
        queryClient.setQueryData(
          ['annotations', paperId],
          context.previousAnnotations
        );
      }
      handleError(_err);
    },

    onSettled: (_data, _err, { paperId }) => {
      queryClient.invalidateQueries({ queryKey: ['annotations', paperId] });
    },
  });
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; paperId: string }) =>
      getAPI().db.annotations.delete(id),

    onMutate: async ({ id, paperId }) => {
      await queryClient.cancelQueries({
        queryKey: ['annotations', paperId],
      });

      const previousAnnotations = queryClient.getQueryData<Annotation[]>([
        'annotations',
        paperId,
      ]);

      if (previousAnnotations) {
        queryClient.setQueryData<Annotation[]>(
          ['annotations', paperId],
          previousAnnotations.filter((a) => a.id !== id)
        );
      }

      return { previousAnnotations, paperId };
    },

    onError: (_err, { paperId }, context) => {
      if (context?.previousAnnotations) {
        queryClient.setQueryData(
          ['annotations', paperId],
          context.previousAnnotations
        );
      }
      handleError(_err);
    },

    onSettled: (_data, _err, { paperId }) => {
      queryClient.invalidateQueries({ queryKey: ['annotations', paperId] });
    },
  });
}
