import { describe, expect, it } from 'vitest';
import {
  getConceptNameLookup,
  getPaperNameLookup,
  resolveConceptDisplayName,
  resolvePaperDisplayName,
} from './entityDisplayNameCache';

describe('entityDisplayNameCache', () => {
  it('resolves truncated labels and falls back to ids', () => {
    const longPaperTitle = 'A very long paper title that should be truncated for display';
    const longConceptName = 'Concept name that is also long enough to be truncated';
    const paperLookup = getPaperNameLookup([
      { id: 'paper-1', title: longPaperTitle },
    ]);
    const conceptLookup = getConceptNameLookup([
      { id: 'concept-1', name_en: longConceptName },
    ]);

    expect(resolvePaperDisplayName('paper-1', paperLookup)).toBe(longPaperTitle.slice(0, 30));
    expect(resolveConceptDisplayName('concept-1', conceptLookup)).toBe(longConceptName.slice(0, 30));
    expect(resolvePaperDisplayName('paper-missing-12345', paperLookup)).toBe('paper-miss');
    expect(resolveConceptDisplayName('concept-missing-12345', conceptLookup)).toBe('concept-mi');
  });

  it('reuses cached lookup maps for stable query array references', () => {
    const papers = [{ id: 'paper-1', title: 'Paper 1' }];
    const concepts = [{ id: 'concept-1', nameEn: 'Concept 1' }];

    const firstPaperLookup = getPaperNameLookup(papers);
    const secondPaperLookup = getPaperNameLookup(papers);
    const firstConceptLookup = getConceptNameLookup(concepts);
    const secondConceptLookup = getConceptNameLookup(concepts);

    expect(firstPaperLookup).toBe(secondPaperLookup);
    expect(firstConceptLookup).toBe(secondConceptLookup);
  });
});