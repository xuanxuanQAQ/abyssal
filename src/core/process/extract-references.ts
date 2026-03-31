// ═══ 参考文献提取 ═══
// §3: 区域定位 + 条目分割 + DOI/年份正则

import type { ExtractedReference } from '../types';

// ─── §3.2 区域定位正则 ───

const REFERENCES_HEAD_RE = /^(?:references|bibliography|参考文献|works?\s+cited|references?\s+cited)\s*$/i;
const APPENDIX_RE = /^(?:appendix|appendices|附录|supplementary)\s*/i;

// ─── §3.3 条目分割正则 ───

const BRACKET_NUM_RE = /^\[(\d+)\]\s/;
const DOT_NUM_RE = /^(\d+)\.\s/;
const PAREN_NUM_RE = /^\((\d+)\)\s/;

// ─── §3.4 字段提取正则 ───

const DOI_RE = /\b(10\.\d{4,9}\/\S+)/;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;

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

export function extractReferences(fullText: string): ExtractedReference[] {
  const lines = fullText.split('\n');

  // §3.2: 区域定位（两轮从末尾向前扫描，Fix #9: 覆盖短论文）
  let refStartLine: number | null = null;

  // 第一轮：从末尾到 70%
  for (let i = lines.length - 1; i >= Math.floor(lines.length * 0.7); i--) {
    if (REFERENCES_HEAD_RE.test(lines[i]!.trim())) {
      refStartLine = i + 1;
      break;
    }
  }
  // 第二轮：从 70% 到 40%（覆盖短论文）
  if (refStartLine === null) {
    for (let i = Math.floor(lines.length * 0.7) - 1; i >= Math.floor(lines.length * 0.4); i--) {
      if (i >= 0 && REFERENCES_HEAD_RE.test(lines[i]!.trim())) {
        refStartLine = i + 1;
        break;
      }
    }
  }

  if (refStartLine === null) return [];

  // 确定区域终止位置
  let refEndLine = lines.length;
  for (let i = refStartLine; i < lines.length; i++) {
    if (APPENDIX_RE.test(lines[i]!.trim())) {
      refEndLine = i;
      break;
    }
  }

  const refLines = lines.slice(refStartLine, refEndLine).filter((l) => l.trim().length > 0);
  if (refLines.length === 0) return [];

  // §3.3: 条目分割
  const mode = detectSplitMode(refLines);
  const rawEntries = splitEntries(refLines, mode);

  // §3.4: 字段提取
  return rawEntries.map((rawText, i) => ({
    rawText,
    orderIndex: i,
    ...extractFields(rawText),
  }));
}
