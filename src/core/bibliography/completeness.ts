// ═══ 书目完整度检查 ═══
// §5: 必填字段检测 + 完整度比率

import type { PaperId } from '../types/common';
import type { PaperMetadata, PaperType } from '../types/paper';
import type { BiblioCompletenessReport } from '../types/bibliography';
import type { CslEngine } from './csl-engine';

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim().length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function checkBiblioCompleteness(
  paper: PaperMetadata,
  cslStyleId: string,
  engine: CslEngine,
): BiblioCompletenessReport {
  const required = engine.getRequiredFields(paper.paperType);
  const missing: string[] = [];

  for (const field of required) {
    const value = (paper as unknown as Record<string, unknown>)[field];
    if (isEmpty(value)) {
      missing.push(field);
    }
  }

  const completeness = required.length > 0
    ? (required.length - missing.length) / required.length
    : 1.0;

  return {
    paperId: paper.id,
    missingFields: missing,
    completeness,
    cslStyleId,
  };
}
