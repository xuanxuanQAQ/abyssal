/**
 * useArticle -- Wrapper around article outline queries with active article selection
 */

import { useArticleOutlines, useArticleOutline } from '../../../core/ipc/hooks/useArticles';
import type { ArticleOutline } from '../../../../shared-types/models';

interface UseArticleReturn {
  article: ArticleOutline | null;
  isLoading: boolean;
  error: Error | null;
}

export function useArticle(articleId: string | null): UseArticleReturn {
  const { data: outline, isLoading, error } = useArticleOutline(articleId);

  return {
    article: outline ?? null,
    isLoading,
    error,
  };
}

interface UseArticleListReturn {
  articles: ArticleOutline[];
  isLoading: boolean;
}

export function useArticleList(): UseArticleListReturn {
  const { data: outlines, isLoading } = useArticleOutlines();

  return {
    articles: outlines ?? [],
    isLoading,
  };
}
