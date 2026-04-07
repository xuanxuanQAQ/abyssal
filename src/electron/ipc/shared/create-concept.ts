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

function appendConceptSuffix(baseId: string, suffix: number): string {
  const suffixText = `_${suffix}`;
  const truncatedBase = baseId.slice(0, Math.max(1, 64 - suffixText.length));
  return `${truncatedBase}${suffixText}`;
}

async function resolveUniqueConceptId(dbProxy: DbProxyInstance, nameSeed: string) {
  const baseId = deriveConceptId(nameSeed);
  let candidate = baseId;
  let suffix = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await dbProxy.getConcept(asConceptId(candidate));
    if (!existing) {
      return asConceptId(candidate);
    }
    candidate = appendConceptSuffix(baseId, suffix);
    suffix += 1;
  }
}

export async function createConceptFromDraft(
  dbProxy: DbProxyInstance,
  draft: ConceptDraft | Record<string, unknown>,
  fallbackDefinition?: string,
): Promise<string> {
  const nameEn = typeof draft['nameEn'] === 'string' ? draft['nameEn'].trim() : '';
  const nameZh = typeof draft['nameZh'] === 'string' ? draft['nameZh'].trim() : '';
  const conceptId = await resolveUniqueConceptId(dbProxy, nameEn || nameZh);
  const definition = typeof draft['definition'] === 'string'
    ? draft['definition']
    : fallbackDefinition ?? '';
  const searchKeywords = Array.isArray(draft['searchKeywords'])
    ? draft['searchKeywords'].filter((keyword): keyword is string => typeof keyword === 'string')
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
