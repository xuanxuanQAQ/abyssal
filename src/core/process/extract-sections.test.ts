// ═══ Section Detection Tests ═══

import { describe, it, expect } from 'vitest';
import { extractSections } from './extract-sections';
import type { StyledLine } from '../types';

describe('extractSections', () => {
  const baseStyled = (text: string, fontSize = 12, isBold = false, pageIndex = 0): StyledLine => ({
    text,
    fontSize,
    isBold,
    pageIndex,
  });

  it('detects numbered heading: "1. Introduction"', () => {
    const lines = [
      'Some abstract text that is body text.',
      '1. Introduction',
      'Body of introduction paragraph.',
      '2. Methods',
      'Body of methods paragraph.',
    ];
    const styled = [
      baseStyled(lines[0]!),
      baseStyled(lines[1]!, 14, true),
      baseStyled(lines[2]!),
      baseStyled(lines[3]!, 14, true),
      baseStyled(lines[4]!),
    ];
    const fullText = lines.join('\n');
    const { boundaries } = extractSections(fullText, styled);
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
    const labels = boundaries.map(s => s.label);
    expect(labels).toContain('introduction');
    expect(labels).toContain('method');
  });

  it('rejects false heading: numbered list item without font change', () => {
    const lines = [
      '1. First item in a list',
      '2. Second item in a list',
      '3. Third item in a list',
    ];
    const styled = lines.map(l => baseStyled(l, 12, false));
    const fullText = lines.join('\n');
    const { boundaries } = extractSections(fullText, styled);
    // Numbered items with no font differentiation should not be detected as headings
    // (or at most detected as 'unknown' sections)
    expect(boundaries.length).toBeLessThanOrEqual(1);
  });

  it('returns sectionMap for any non-empty text', () => {
    const text = 'Just a single paragraph with no headings at all.';
    const styled = [baseStyled(text)];
    const { sectionMap } = extractSections(text, styled);
    expect(sectionMap.size).toBeGreaterThanOrEqual(1);
  });

  it('handles empty text gracefully', () => {
    const { boundaries } = extractSections('', []);
    // Empty text produces no meaningful section boundaries
    // (may have a fallback 'unknown' section with empty text)
    expect(boundaries.length).toBeLessThanOrEqual(1);
  });

  it('detects numbered heading with larger font + bold', () => {
    const lines = [
      'Some text in the body of the paper.',
      '4. Discussion',
      'More text about the discussion topic.',
    ];
    const styled = [
      baseStyled(lines[0]!, 12, false),
      baseStyled(lines[1]!, 14, true), // larger + bold + numbered
      baseStyled(lines[2]!, 12, false),
    ];
    const fullText = lines.join('\n');
    const { boundaries } = extractSections(fullText, styled);
    const disc = boundaries.find(s => s.label === 'discussion');
    expect(disc).toBeDefined();
  });

  it('detects "Conclusion" heading with larger font', () => {
    const lines = [
      'Discussion about results.',
      '5. Conclusion',
      'We conclude that...',
    ];
    const styled = [
      baseStyled(lines[0]!),
      baseStyled(lines[1]!, 16, true),
      baseStyled(lines[2]!),
    ];
    const fullText = lines.join('\n');
    const { boundaries } = extractSections(fullText, styled);
    const conc = boundaries.find(s => s.label === 'conclusion');
    expect(conc).toBeDefined();
  });
});
