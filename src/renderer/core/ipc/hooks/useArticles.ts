/**
 * useArticles — 文章/纲要/节 查询与写操作 hooks
 *
 * Query Key: ['articles', 'outlines'] / ['articles', 'outline', articleId]
 *            ['articles', 'section', sectionId] / ['articles', 'versions', sectionId]
 *
 * 节内容保存采用防抖 + 静默保存策略
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { SectionOrder, SectionPatch, ArticleOutline } from '../../../../shared-types/models';
import { handleError } from '../../errors/errorHandlers';

// ── 纲要查询 ──

export function useArticleOutlines() {
  return useQuery({
    queryKey: ['articles', 'outlines'],
    queryFn: () => getAPI().db.articles.listOutlines(),
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function useArticleOutline(articleId: string | null) {
  return useQuery({
    queryKey: ['articles', 'outline', articleId],
    queryFn: () => getAPI().db.articles.getOutline(articleId!),
    enabled: articleId !== null,
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

// ── 节内容查询 ──

export function useSection(sectionId: string | null) {
  return useQuery({
    queryKey: ['articles', 'section', sectionId],
    queryFn: () => getAPI().db.articles.getSection(sectionId!),
    enabled: sectionId !== null,
    staleTime: 0,
    gcTime: 300_000,
  });
}

export function useSectionVersions(sectionId: string | null) {
  return useQuery({
    queryKey: ['articles', 'versions', sectionId],
    queryFn: () => getAPI().db.articles.getSectionVersions(sectionId!),
    enabled: sectionId !== null,
    staleTime: 60_000,
    gcTime: 300_000,
  });
}

// ── 写操作 ──

export function useUpdateOutlineOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      articleId,
      order,
    }: {
      articleId: string;
      order: SectionOrder[];
    }) => getAPI().db.articles.updateOutlineOrder(articleId, order),

    onSuccess: (_data, { articleId }) => {
      queryClient.invalidateQueries({
        queryKey: ['articles', 'outline', articleId],
      });
    },

    onError: (err) => handleError(err),
  });
}

/**
 * 节内容保存 mutation
 *
 * 使用方在编辑器组件中通过 1500ms 防抖调用此 mutation，
 * 而非每次击键都触发。
 */
export function useUpdateSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sectionId,
      patch,
    }: {
      sectionId: string;
      patch: SectionPatch;
    }) => getAPI().db.articles.updateSection(sectionId, patch),

    onSuccess: (_data, { sectionId }) => {
      queryClient.invalidateQueries({
        queryKey: ['articles', 'section', sectionId],
      });
      queryClient.invalidateQueries({
        queryKey: ['articles', 'versions', sectionId],
      });
    },

    onError: (err) => handleError(err),
  });
}

// ── 文章 CRUD ──

export function useCreateArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title: string) => getAPI().db.articles.create(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['articles', 'outlines'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useUpdateArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      articleId,
      patch,
    }: {
      articleId: string;
      patch: Partial<ArticleOutline>;
    }) => getAPI().db.articles.update(articleId, patch),

    onSuccess: (_data, { articleId }) => {
      queryClient.invalidateQueries({
        queryKey: ['articles', 'outline', articleId],
      });
      queryClient.invalidateQueries({ queryKey: ['articles', 'outlines'] });
    },
    onError: (err) => handleError(err),
  });
}

// ── 节 CRUD ──

export function useCreateSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      articleId,
      parentId,
      sortIndex,
      title,
    }: {
      articleId: string;
      parentId: string | null;
      sortIndex: number;
      title?: string | undefined;
    }) => getAPI().db.articles.createSection(articleId, parentId, sortIndex, title),

    onSuccess: (_data, { articleId }) => {
      queryClient.invalidateQueries({
        queryKey: ['articles', 'outline', articleId],
      });
    },
    onError: (err) => handleError(err),
  });
}

export function useDeleteSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sectionId,
      articleId,
    }: {
      sectionId: string;
      articleId: string;
    }) => getAPI().db.articles.deleteSection(sectionId),

    onSuccess: (_data, { articleId }) => {
      queryClient.invalidateQueries({
        queryKey: ['articles', 'outline', articleId],
      });
    },
    onError: (err) => handleError(err),
  });
}
