/**
 * Shared utility: create a concept from a draft object.
 * Used by memos-handler (upgradeToConcept) and notes-handler (upgradeToConcept).
 */

import { asConceptId } from '../../../core/types/common';
import type { DbProxyInstance } from '../../../db-process/db-proxy';

export function deriveConceptId(nameEn: string): string {
  return (
    nameEn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 64) || `concept_${Date.now()}`
  );
}

export async function createConceptFromDraft(
  dbProxy: DbProxyInstance,
  draft: Record<string, unknown>,
  fallbackDefinition?: string,
): Promise<string> {
  const conceptId = asConceptId(deriveConceptId((draft['nameEn'] as string) ?? ''));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (dbProxy as any).addConcept({
    id: conceptId,
    nameZh: (draft['nameZh'] as string) ?? '',
    nameEn: (draft['nameEn'] as string) ?? '',
    layer: 'domain',
    definition: (draft['definition'] as string) ?? fallbackDefinition ?? '',
    searchKeywords: (draft['keywords'] as string[]) ?? [],
    maturity: 'tentative',
    parentId: (draft['parentId'] as string) ?? null,
    history: [],
    deprecated: false,
    deprecatedAt: null,
    deprecatedReason: null,
    createdAt: new Date().toISOString(),
  });

  return conceptId;
}
