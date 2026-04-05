import { describe, expect, it } from 'vitest';
import { extractSections } from '../../../src/core/process/extract-sections';
import type { StyledLine } from '../../../src/core/process/types';

function makeStyled(text: string, fontSize = 12, isBold = false, pageIndex = 0): StyledLine {
  return { text, fontSize, isBold, pageIndex };
}

describe('extractSections robustness', () => {
  it('does not absorb references into the preceding results section', () => {
    const lines = [
      '3 Results',
      'The model improved recall by 12 percent over the baseline.',
      'References',
      '[1] A cited paper.',
      '[2] Another cited paper.',
    ];
    const styled = [
      makeStyled(lines[0]!, 14, true),
      makeStyled(lines[1]!),
      makeStyled(lines[2]!, 14, true),
      makeStyled(lines[3]!),
      makeStyled(lines[4]!),
    ];

    const result = extractSections(lines.join('\n'), styled);
    const resultsText = result.sectionMap.get('results') ?? '';

    expect(resultsText).toContain('improved recall');
    expect(resultsText).not.toContain('[1] A cited paper.');
    expect(result.boundaries.map((entry) => entry.label)).toContain('results');
  });

  it('falls back to unknown without inventing structured headings from OCR-like garbage', () => {
    const lines = [
      '1 1 1 1 1',
      'I I I I',
      '::::',
      'unstructured OCR noise with no true heading markers',
    ];
    const styled = lines.map((line) => makeStyled(line, 12, false));

    const result = extractSections(lines.join('\n'), styled);
    const unknownText = result.sectionMap.get('unknown') ?? '';

    expect(result.boundaries.filter((entry) => entry.label !== 'unknown')).toHaveLength(0);
    expect(unknownText).toContain('unstructured OCR noise');
  });
});
