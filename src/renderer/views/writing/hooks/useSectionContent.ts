/**
 * useSectionContent -- Section content fetching
 *
 * Thin wrapper around useSection that provides a convenient shape
 * with default values for content and version when no section is loaded.
 */

import { useSection } from '../../../core/ipc/hooks/useArticles';

interface UseSectionContentReturn {
  content: string;
  version: number;
  isLoading: boolean;
  error: Error | null;
}

export function useSectionContent(sectionId: string | null): UseSectionContentReturn {
  const { data: section, isLoading, error } = useSection(sectionId);

  return {
    content: section?.content ?? '',
    version: section?.version ?? 0,
    isLoading,
    error,
  };
}
