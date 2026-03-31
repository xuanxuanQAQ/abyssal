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

  // ─── 基础功能 ───

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

  // ─── Fix #6: styledByLineIndex 碰撞测试 ───

  it('handles repeated text lines without styled collision', () => {
    const lines = [
      '1. Results',
      'Body text of results section.',
      'Results', // This "Results" is body text, not a heading
      '2. Discussion',
      'Discussion body text.',
    ];
    const styled = [
      baseStyled(lines[0]!, 14, true),    // heading
      baseStyled(lines[1]!, 12, false),
      baseStyled(lines[2]!, 12, false),    // "Results" as body text (small font)
      baseStyled(lines[3]!, 14, true),     // heading
      baseStyled(lines[4]!, 12, false),
    ];
    const fullText = lines.join('\n');
    const { boundaries } = extractSections(fullText, styled);

    const resultsBoundaries = boundaries.filter(b => b.label === 'results');
    // Should detect "1. Results" as heading but NOT the standalone "Results" body text
    expect(resultsBoundaries.length).toBe(1);
  });

  // ─── Fix #7: 多级标题 depth ───

  it('assigns depth to section boundaries', () => {
    const lines = [
      '1 Introduction',
      'Intro text.',
      '2 Methods',
      'Methods overview.',
      '2.1 Data Collection',
      'Data collection details.',
      '2.2 Analysis',
      'Analysis details.',
      '3 Results',
      'Results text.',
    ];
    const styled = [
      baseStyled(lines[0]!, 14, true),
      baseStyled(lines[1]!),
      baseStyled(lines[2]!, 14, true),
      baseStyled(lines[3]!),
      baseStyled(lines[4]!, 13, true),
      baseStyled(lines[5]!),
      baseStyled(lines[6]!, 13, true),
      baseStyled(lines[7]!),
      baseStyled(lines[8]!, 14, true),
      baseStyled(lines[9]!),
    ];
    const fullText = lines.join('\n');
    const { boundaries } = extractSections(fullText, styled);

    // Top-level headings should have depth 1
    const intro = boundaries.find(b => b.label === 'introduction');
    expect(intro?.depth).toBe(1);

    // Sub-headings with same label as parent should not create separate boundaries
    // (they are absorbed into the parent section text)
    const methodBoundaries = boundaries.filter(b => b.label === 'method');
    expect(methodBoundaries.length).toBe(1);
  });

  // ─── Fix #8: Abstract 误截断 ───

  it('does not truncate abstract at numbered lists inside it', () => {
    const lines = [
      'Abstract',
      'This paper presents three contributions:',
      '1. We propose a novel method.',
      '2. We evaluate it extensively.',
      '3. We show state-of-the-art results.',
      '1 Introduction',
      'The introduction begins here.',
    ];
    // Numbered items inside abstract have same font as body (12pt, not bold)
    // Only "1 Introduction" has larger font (14pt bold)
    const styled = [
      baseStyled(lines[0]!, 14, true),
      baseStyled(lines[1]!),
      baseStyled(lines[2]!),    // 12pt, not bold → should NOT be detected as heading
      baseStyled(lines[3]!),    // 12pt, not bold
      baseStyled(lines[4]!),    // 12pt, not bold
      baseStyled(lines[5]!, 14, true),  // real heading
      baseStyled(lines[6]!),
    ];
    const fullText = lines.join('\n');
    const { sectionMap } = extractSections(fullText, styled);

    const abstractText = sectionMap.get('abstract') ?? '';
    // Abstract should contain all 3 numbered items
    expect(abstractText).toContain('We propose a novel method');
    expect(abstractText).toContain('We evaluate it extensively');
    expect(abstractText).toContain('We show state-of-the-art results');
  });

  // ─── Fix #9: 短论文 References 检测 ───

  it('finds references in short paper (before 70% mark)', () => {
    // Simulate a very short paper where "References" appears at ~55% mark
    const lines = [
      '1 Introduction',
      'Short intro.',
      '2 Method',
      'Short method.',
      '3 Results',
      'Short results.',
      'References',
      '[1] Some reference.',
      '[2] Another reference.',
    ];
    const styled = lines.map((l, i) => {
      if (i === 0 || i === 2 || i === 4) return baseStyled(l, 14, true);
      if (i === 6) return baseStyled(l, 14, true);
      return baseStyled(l);
    });
    const fullText = lines.join('\n');
    const { boundaries } = extractSections(fullText, styled);

    // References should be detected and sections should stop before it
    const labels = boundaries.map(b => b.label);
    expect(labels).not.toContain('unknown');
    // Should have at least intro, method, results
    expect(labels).toContain('introduction');
    expect(labels).toContain('method');
    expect(labels).toContain('results');
  });

  // ─── charStart/charEnd output ───

  it('outputs sectionMapV2 with charStart and charEnd', () => {
    const lines = [
      '1 Introduction',
      'Body of introduction.',
      '2 Methods',
      'Body of methods.',
    ];
    const styled = [
      baseStyled(lines[0]!, 14, true),
      baseStyled(lines[1]!),
      baseStyled(lines[2]!, 14, true),
      baseStyled(lines[3]!),
    ];
    const fullText = lines.join('\n');
    const { sectionMapV2 } = extractSections(fullText, styled);

    const intro = sectionMapV2.get('introduction');
    expect(intro).toBeDefined();
    expect(intro!.charStart).toBeGreaterThanOrEqual(0);
    expect(intro!.charEnd).toBeGreaterThan(intro!.charStart);
    expect(intro!.text).toBe('Body of introduction.');

    const method = sectionMapV2.get('method');
    expect(method).toBeDefined();
    expect(method!.charStart).toBeGreaterThan(intro!.charStart);
    expect(method!.text).toBe('Body of methods.');
  });

  // ─── 无标题文档降级 ───

  it('falls back to unknown section for headingless text', () => {
    const text = 'Just plain text with no headings whatsoever. More plain text.';
    const styled = [baseStyled(text)];
    const { sectionMap, sectionMapV2, boundaries } = extractSections(text, styled);

    expect(sectionMap.has('unknown')).toBe(true);
    expect(sectionMapV2.has('unknown')).toBe(true);
    expect(sectionMapV2.get('unknown')!.charStart).toBe(0);
    expect(boundaries.some(b => b.label === 'unknown')).toBe(true);
  });
});
