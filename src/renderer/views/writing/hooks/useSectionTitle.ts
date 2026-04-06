import { useMemo } from 'react';
import type { SectionNode } from '../../../../shared-types/models';
import { useArticle } from './useArticle';

function findSectionTitle(sections: SectionNode[], sectionId: string): string | null {
  for (const section of sections) {
    if (section.id === sectionId) {
      return section.title;
    }
    const nested = findSectionTitle(section.children, sectionId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function useSectionTitle(articleId: string | null, sectionId: string | null): string | null {
  const { article } = useArticle(articleId);

  return useMemo(() => {
    if (!article || !sectionId) return null;
    return findSectionTitle(article.sections, sectionId);
  }, [article, sectionId]);
}