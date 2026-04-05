/**
 * Shared utility: create a concept from a draft object.
 * Used by memos-handler (upgradeToConcept) and notes-handler (upgradeToConcept).
 */

import { asConceptId } from '../../../core/types/common';
import type { DbProxyInstance } from '../../../db-process/db-proxy';
import type { ConceptDraft } from '../../../shared-types/models';

export function deriveConceptId(nameSeed: string): string {
  return (
    nameSeed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 64) || `concept_${Date.now()}`
  );
}

export async function createConceptFromDraft(
  dbProxy: DbProxyInstance,
  draft: ConceptDraft | Record<string, unknown>,
  fallbackDefinition?: string,
): Promise<string> {
  const nameEn = typeof draft['nameEn'] === 'string' ? draft['nameEn'].trim() : '';
  const nameZh = typeof draft['nameZh'] === 'string' ? draft['nameZh'].trim() : '';
  const conceptId = asConceptId(deriveConceptId(nameEn || nameZh));
  const definition = typeof draft['definition'] === 'string'
    ? draft['definition']
    : fallbackDefinition ?? '';
  const searchKeywords = Array.isArray(draft['keywords'])
    ? draft['keywords'].filter((keyword): keyword is string => typeof keyword === 'string')
    : [];
  const parentId = typeof draft['parentId'] === 'string' ? draft['parentId'] : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (dbProxy as any).addConcept({
    id: conceptId,
    nameZh,
    nameEn,
    layer: 'domain',
    definition,
    searchKeywords,
    maturity: 'tentative',
    parentId,
    history: [],
    deprecated: false,
    deprecatedAt: null,
    deprecatedReason: null,
    createdAt: new Date().toISOString(),
  });

  return conceptId;
}
