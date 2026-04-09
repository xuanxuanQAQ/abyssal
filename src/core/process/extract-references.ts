// ═══ 参考文献提取 ═══
// §3: 区域定位 + 条目分割 + DOI/年份正则

import type { ExtractedReference } from './types';
import type { Logger } from '../infra/logger';
import type { DocumentStructure } from '../dla/types';

// ─── §3.2 区域定位正则 ───

// 允许可选的章节编号前缀：
//   "7. References", "V. REFERENCES", "第五章 参考文献", "5 参考文献"
const SECTION_NUM_PREFIX = /^(?:(?:\d+|[IVXLC]+)[.\s)\-:]\s*|(?:第.{1,3}[章节]\s*)|(?:chapter\s+\d+[.\s:]\s*))?/i;
const REFERENCES_KEYWORD_RE = /(?:references|bibliography|参考文献|works?\s+cited|references?\s+cited)\s*[:：]?\s*$/i;
const REFERENCES_HEAD_RE = new RegExp(
  SECTION_NUM_PREFIX.source + REFERENCES_KEYWORD_RE.source,
  'i',
);
const APPENDIX_RE = /^(?:appendix|appendices|附录|supplementary)\s*/i;

// ─── §3.3 条目分割正则 ───

const BRACKET_NUM_RE = /^\[(\d+)\]\s/;
const DOT_NUM_RE = /^(\d+)\.\s/;
const PAREN_NUM_RE = /^\((\d+)\)\s/;

// ─── §3.4 字段提取正则 ───

const DOI_RE = /\b(10\.\d{4,9}\/\S+)/;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;

function normalizeFullWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
}

function normalizeDocumentLine(text: string): string {
  return normalizeFullWidthDigits(text)
    .replace(/[\u3000\u00A0]/g, ' ')
    .replace(/[．﹒·•‧∙⋅。]/g, '.')
    .replace(/(\d)[ư](\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectStackedChineseReferencesHeading(lines: string[], index: number): boolean {
  if (index + 3 >= lines.length) return false;
  const joined = lines.slice(index, index + 4)
    .map((line) => normalizeDocumentLine(line).replace(/\s+/g, ''))
    .join('');
  return joined === '参考文献';
}

function findReferenceHeading(lines: string[], start: number, end: number): { startLine: number; heading: string; headingLineCount: number } | null {
  for (let i = end; i >= start; i--) {
    const trimmed = normalizeDocumentLine(lines[i] ?? '');
    if (REFERENCES_HEAD_RE.test(trimmed)) {
      return { startLine: i + 1, heading: trimmed, headingLineCount: 1 };
    }
    if (detectStackedChineseReferencesHeading(lines, i)) {
      return { startLine: i + 4, heading: '参考文献', headingLineCount: 4 };
    }
  }
  return null;
}

// ─── 清理 DOI 尾部标点 ───

function cleanDoi(doi: string): string {
  return doi.replace(/[.,;:)\]}>]+$/, '');
}

// ─── §3.3 检测条目分割模式 ───

type SplitMode = 'bracket' | 'dot' | 'paren' | 'indent';

function detectSplitMode(lines: string[]): SplitMode {
  const sample = lines.slice(0, 10);
  let bracketCount = 0;
  let dotCount = 0;
  let parenCount = 0;

  for (const line of sample) {
    if (BRACKET_NUM_RE.test(line)) bracketCount++;
    if (DOT_NUM_RE.test(line)) dotCount++;
    if (PAREN_NUM_RE.test(line)) parenCount++;
  }

  const max = Math.max(bracketCount, dotCount, parenCount);
  if (max >= 2) {
    if (bracketCount === max) return 'bracket';
    if (dotCount === max) return 'dot';
    return 'paren';
  }

  // 悬挂缩进检测
  return 'indent';
}

// ─── 按模式分割条目 ───

function splitEntries(lines: string[], mode: SplitMode): string[] {
  const entries: string[] = [];
  let currentEntry: string[] = [];

  const isNewEntry = (line: string): boolean => {
    switch (mode) {
      case 'bracket': return BRACKET_NUM_RE.test(line);
      case 'dot': return DOT_NUM_RE.test(line);
      case 'paren': return PAREN_NUM_RE.test(line);
      case 'indent': {
        // 悬挂缩进检测：前导空白 = 0 的行起始新条目。
        // 注意：mupdf.js preserve-whitespace 模式下物理空格数可能不稳定（±1-2 空格）。
        // 当前使用简单的 ≥2 空格阈值作为折中。
        // 更准确方案：接受可选的 x0Coords: Map<number, number[]> 参数（来自 stext.walk 的
        // origin 坐标），对每行首字符的 x0 做 K-means 或简单阈值聚类，动态判定缩进层级。
        return line.length > 0 && !/^\s{2,}/.test(line);
      }
    }
  };

  for (const line of lines) {
    if (isNewEntry(line) && currentEntry.length > 0) {
      entries.push(currentEntry.join(' ').trim());
      currentEntry = [line];
    } else {
      currentEntry.push(line);
    }
  }

  if (currentEntry.length > 0) {
    const text = currentEntry.join(' ').trim();
    if (text.length > 0) entries.push(text);
  }

  return entries;
}

// ─── §3.4 条目字段提取 ───

function extractFields(rawText: string): Pick<ExtractedReference, 'doi' | 'year' | 'roughAuthors' | 'roughTitle'> {
  // DOI
  const doiMatch = DOI_RE.exec(rawText);
  const doi = doiMatch ? cleanDoi(doiMatch[1]!) : null;

  // 年份
  const yearMatch = YEAR_RE.exec(rawText);
  const year = yearMatch ? parseInt(yearMatch[1]!, 10) : null;

  // 粗略作者（第一个年份之前的部分）
  let roughAuthors: string | null = null;
  let roughTitle: string | null = null;

  if (yearMatch && yearMatch.index !== undefined) {
    roughAuthors = rawText.slice(0, yearMatch.index).trim().replace(/[,.]$/, '') || null;

    // 粗略标题（年份后到期刊名/DOI 前的文本段）
    const afterYear = rawText.slice(yearMatch.index + yearMatch[0].length).trim();
    // 去除紧跟年份的标点和括号
    const titleStart = afterYear.replace(/^[).\s,]+/, '');
    // 取到下一个句号或 DOI 之前
    const titleEnd = titleStart.search(/\.\s|10\.\d{4}/);
    roughTitle = titleEnd > 0 ? titleStart.slice(0, titleEnd).trim() : titleStart.slice(0, 200).trim();
    if (roughTitle.length === 0) roughTitle = null;
  }

  return { doi, year, roughAuthors, roughTitle };
}

// ─── §3.1 extractReferences 主函数 ───

export function extractReferences(fullText: string, logger?: Logger | null): ExtractedReference[] {
  const lines = fullText.split('\n');
  const scanFrom70 = Math.floor(lines.length * 0.7);
  const scanFrom40 = Math.floor(lines.length * 0.4);

  logger?.debug('[extractReferences] start', {
    totalLines: lines.length,
    scanRange: `${scanFrom40}-${lines.length}`,
  });

  // §3.2: 区域定位（两轮从末尾向前扫描，Fix #9: 覆盖短论文）
  let refStartLine: number | null = null;
  let matchedHeading: string | null = null;
  let headingLineCount = 0;

  // 第一轮：从末尾到 70%
  const tailHeading = findReferenceHeading(lines, scanFrom70, lines.length - 1);
  if (tailHeading) {
    refStartLine = tailHeading.startLine;
    matchedHeading = tailHeading.heading;
    headingLineCount = tailHeading.headingLineCount;
  }
  // 第二轮：从 70% 到 40%（覆盖短论文）
  if (refStartLine === null) {
    const midHeading = findReferenceHeading(lines, scanFrom40, scanFrom70 - 1);
    if (midHeading) {
      refStartLine = midHeading.startLine;
      matchedHeading = midHeading.heading;
      headingLineCount = midHeading.headingLineCount;
    }
  }
  if (refStartLine === null) {
    const headHeading = findReferenceHeading(lines, 0, scanFrom40 - 1);
    if (headHeading) {
      refStartLine = headHeading.startLine;
      matchedHeading = headHeading.heading;
      headingLineCount = headHeading.headingLineCount;
    }
  }

  if (refStartLine === null) {
    // 诊断：输出尾部 30% 的非空行，帮助排查标题格式
    const tailStart = scanFrom70;
    const tailLines = lines.slice(tailStart)
      .map((l, i) => ({ lineNo: tailStart + i, text: l.trim() }))
      .filter((l) => l.text.length > 0 && l.text.length < 80)
      .slice(0, 15);
    logger?.warn('[extractReferences] No references heading found', {
      totalLines: lines.length, scanRange: `${scanFrom40}-${lines.length}`,
      tailSample: tailLines,
    });
    return [];
  }

  logger?.debug('[extractReferences] heading found', {
    heading: matchedHeading, lineNo: refStartLine - headingLineCount,
  });

  // 确定区域终止位置
  let refEndLine = lines.length;
  for (let i = refStartLine; i < lines.length; i++) {
    if (APPENDIX_RE.test(normalizeDocumentLine(lines[i]!))) {
      refEndLine = i;
      break;
    }
  }

  const refLines = lines.slice(refStartLine, refEndLine).filter((l) => l.trim().length > 0);
  if (refLines.length === 0) {
    logger?.warn('[extractReferences] References section empty', {
      startLine: refStartLine, endLine: refEndLine,
    });
    return [];
  }

  // §3.3: 条目分割
  const mode = detectSplitMode(refLines);
  const rawEntries = splitEntries(refLines, mode);

  logger?.debug('[extractReferences] split complete', {
    refLineCount: refLines.length, splitMode: mode,
    entryCount: rawEntries.length,
    firstEntry: rawEntries[0]?.slice(0, 120),
  });

  // §3.4: 字段提取
  return rawEntries.map((rawText, i) => ({
    rawText,
    orderIndex: i,
    ...extractFields(rawText),
  }));
}

// ═══ Layout-based reference extraction (DLA path) ═══

/**
 * Extract references using DLA-detected reference section.
 *
 * Skips the regex-based heading scan entirely — the DocumentStructure
 * already identifies the reference section via visual block detection.
 * The existing split/field-extraction logic is reused on the DLA text.
 */
export function extractReferencesFromLayout(
  structure: DocumentStructure,
  logger?: Logger | null,
): ExtractedReference[] {
  if (!structure.referenceSection) {
    logger?.warn('[extractReferencesFromLayout] No reference section detected by DLA');
    return [];
  }

  const entries = structure.referenceSection.entries;
  if (entries.length === 0) {
    logger?.warn('[extractReferencesFromLayout] Reference section has no text entries');
    return [];
  }

  // Concatenate entry block text and apply existing split logic
  const refText = entries
    .filter((b) => b.text != null)
    .map((b) => b.text!)
    .join('\n');

  const refLines = refText.split('\n').filter((l) => l.trim().length > 0);
  if (refLines.length === 0) return [];

  const mode = detectSplitMode(refLines);
  const rawEntries = splitEntries(refLines, mode);

  logger?.debug('[extractReferencesFromLayout] split complete', {
    blockCount: entries.length,
    refLineCount: refLines.length,
    splitMode: mode,
    entryCount: rawEntries.length,
  });

  return rawEntries.map((rawText, i) => ({
    rawText,
    orderIndex: i,
    ...extractFields(rawText),
  }));
}
