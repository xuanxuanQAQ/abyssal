// ═══ 启发式结构识别 ═══
// §2: 正则三层 + Abstract 特殊处理 + 关键词→SectionLabel 映射

import type { SectionLabel, SectionType, SectionMap, SectionBoundary, SectionBoundaryList } from '../types/chunk';
import type { StyledLine } from '../types';

// ─── §2.2 节标题正则 ───

// 层级 1：编号+标题（1 Introduction, 3.2 Experimental Setup）
const NUMBERED_RE = /^(\d+(?:\.\d+)*)\s*\.?\s+(.+)$/;

// 层级 2：全大写标题（INTRODUCTION, RELATED WORK）
const UPPERCASE_RE = /^([A-Z][A-Z\s\-:]{2,})$/;

// 层级 3：罗马数字编号（I. Introduction, IV. Results）
const ROMAN_RE = /^(I{1,3}|IV|VI{0,3}|IX|X{0,3})\.\s+(.+)$/i;

// ─── §2.4 关键词→SectionLabel 映射（按优先级排列） ───

const LABEL_KEYWORDS: [SectionLabel, string[]][] = [
  ['abstract', ['abstract']],
  ['introduction', ['introduction', 'overview']],
  ['background', ['background', 'preliminary', 'preliminaries']],
  ['literature_review', ['related work', 'literature review', 'prior work', 'state of the art']],
  ['method', ['method', 'methodology', 'approach', 'framework', 'system design', 'model', 'proposed', 'experimental setup', 'implementation']],
  ['results', ['result', 'finding', 'experiment', 'evaluation', 'performance', 'empirical']],
  ['discussion', ['discussion', 'analysis', 'implications']],
  ['conclusion', ['conclusion', 'summary', 'future work', 'concluding']],
  ['appendix', ['appendix', 'supplementary']],
];

function classifyTitle(title: string): SectionLabel {
  const lower = title.toLowerCase();
  for (const [label, keywords] of LABEL_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return label;
    }
  }
  return 'unknown';
}

// ─── §2.4 SectionLabel → SectionType ───

const LABEL_TO_TYPE: Record<SectionLabel, SectionType | null> = {
  abstract: 'introduction',
  introduction: 'introduction',
  background: 'theory',
  literature_review: 'literature_review',
  method: 'methods',
  results: 'results',
  discussion: 'discussion',
  conclusion: 'conclusion',
  appendix: 'methods',
  unknown: null,
};

// ─── §2.3 References 区域标志正则 ───

const REFERENCES_RE = /^(?:references|bibliography|参考文献|works?\s+cited|references?\s+cited)\s*$/i;
const APPENDIX_RE = /^(?:appendix|appendices|附录)\s*([A-Z]|\d+)?\.?\s*(.*)/i;

// ─── §2.3 Abstract 提取 ───

function extractAbstract(lines: string[], totalLines: number): { text: string; endLine: number } | null {
  const searchLimit = Math.ceil(totalLines * 0.2);

  for (let i = 0; i < Math.min(searchLimit, lines.length); i++) {
    const line = lines[i]!.trim();

    // 独立行 "Abstract"
    if (/^abstract\s*$/i.test(line)) {
      const textLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!.trim();
        // 遇到下一个节标题或空行后的标题模式时停止
        if (NUMBERED_RE.test(l) || UPPERCASE_RE.test(l) || ROMAN_RE.test(l)) {
          return { text: textLines.join('\n'), endLine: j };
        }
        textLines.push(lines[j]!);
      }
      return { text: textLines.join('\n'), endLine: lines.length };
    }

    // 行内 "Abstract." 或 "Abstract—"
    const inlineMatch = /^abstract[.—:\-]\s*/i.exec(line);
    if (inlineMatch) {
      const firstPart = line.slice(inlineMatch[0].length);
      const textLines: string[] = [firstPart];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!.trim();
        if (NUMBERED_RE.test(l) || UPPERCASE_RE.test(l) || ROMAN_RE.test(l)) {
          return { text: textLines.join('\n'), endLine: j };
        }
        textLines.push(lines[j]!);
      }
      return { text: textLines.join('\n'), endLine: lines.length };
    }
  }

  return null;
}

// ─── 检测节标题 ───
// 改进：结合字体元数据过滤误报。真正的节标题通常满足
// (正则匹配) AND (字体大于正文基准 OR 字体加粗)。

interface RawHeading {
  lineIndex: number;
  title: string;
}

/** 计算正文基准字体大小（所有行中字体大小的众数） */
function computeBaselineFontSize(styledLines: StyledLine[]): number {
  if (styledLines.length === 0) return 0;
  const freq = new Map<number, number>();
  for (const line of styledLines) {
    if (line.fontSize <= 0) continue;
    const rounded = Math.round(line.fontSize * 10) / 10;
    freq.set(rounded, (freq.get(rounded) ?? 0) + 1);
  }
  let maxCount = 0;
  let baseline = 0;
  for (const [size, count] of freq) {
    if (count > maxCount) { maxCount = count; baseline = size; }
  }
  return baseline;
}

function detectHeading(
  line: string,
  lineIndex: number,
  styledLine: StyledLine | undefined,
  baselineFontSize: number,
): RawHeading | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length >= 100) return null;

  let regexMatch = false;

  // 层级 1：编号+标题
  const m1 = NUMBERED_RE.exec(trimmed);
  if (m1 && m1[2] && !/^[a-z]/.test(m1[2])) {
    regexMatch = true;
  }

  // 层级 2：全大写
  if (!regexMatch && trimmed.length < 60 && UPPERCASE_RE.test(trimmed) && !/^\d+$/.test(trimmed)) {
    regexMatch = true;
  }

  // 层级 3：罗马数字
  if (!regexMatch && ROMAN_RE.test(trimmed)) {
    regexMatch = true;
  }

  if (!regexMatch) return null;

  // 字体元数据验证：有 styledLine 时，要求字体大于基准 OR 加粗
  // 无 styledLine 时（OCR 页面等）回退到仅正则
  if (styledLine && baselineFontSize > 0) {
    const isLargerFont = styledLine.fontSize > baselineFontSize * 1.05;
    const isBold = styledLine.isBold;
    if (!isLargerFont && !isBold) {
      // 正则匹配但字体不符合标题特征→大概率是有序列表误报
      return null;
    }
  }

  return { lineIndex, title: trimmed };
}

// ─── §2.1 extractSections 主函数 ───

export interface ExtractSectionsResult {
  sectionMap: SectionMap;
  boundaries: SectionBoundaryList;
}

/**
 * @param styledLines 带字体元数据的行列表（来自 extractText）。
 *   提供时会用字体大小/粗体过滤正则误报；不提供时回退到仅正则。
 */
export function extractSections(
  fullText: string,
  styledLines?: StyledLine[],
): ExtractSectionsResult {
  const lines = fullText.split('\n');
  const boundaries: SectionBoundaryList = [];

  // 构建行号→StyledLine 的快速查找（通过文本内容匹配）
  const styledByText = new Map<string, StyledLine>();
  if (styledLines) {
    for (const sl of styledLines) {
      const key = sl.text.trim();
      if (key.length > 0 && !styledByText.has(key)) {
        styledByText.set(key, sl);
      }
    }
  }
  const baselineFontSize = styledLines ? computeBaselineFontSize(styledLines) : 0;
  const sectionMap: SectionMap = new Map();

  // §2.3: Abstract 特殊提取
  const abstractResult = extractAbstract(lines, lines.length);
  if (abstractResult && abstractResult.text.trim().length > 0) {
    boundaries.push({
      lineIndex: 0,
      label: 'abstract',
      title: 'Abstract',
      type: 'introduction',
    });
    sectionMap.set('abstract', abstractResult.text.trim());
  }

  // 扫描节标题
  const startLine = abstractResult?.endLine ?? 0;
  let referencesStartLine: number | null = null;

  // §2.3: References 区域定位（从末尾向前）
  for (let i = lines.length - 1; i >= Math.floor(lines.length * 0.7); i--) {
    if (REFERENCES_RE.test(lines[i]!.trim())) {
      referencesStartLine = i;
      break;
    }
  }

  const endScanLine = referencesStartLine ?? lines.length;

  for (let i = startLine; i < endScanLine; i++) {
    const lineText = lines[i]!;
    const styledLine = styledByText.get(lineText.trim());
    const heading = detectHeading(lineText, i, styledLine, baselineFontSize);
    if (heading) {
      const label = classifyTitle(heading.title);

      // 跳过 abstract（已单独处理）
      if (label === 'abstract') continue;

      // Appendix 检测
      if (APPENDIX_RE.test(heading.title)) {
        boundaries.push({
          lineIndex: i,
          label: 'appendix',
          title: heading.title,
          type: 'methods',
        });
        continue;
      }

      boundaries.push({
        lineIndex: i,
        label,
        title: heading.title,
        type: LABEL_TO_TYPE[label],
      });
    }
  }

  // §2.5: 节边界切分
  // 按 boundaries 中非 abstract 条目的行号切分文本
  const nonAbstractBoundaries = boundaries.filter((b) => b.label !== 'abstract');

  for (let idx = 0; idx < nonAbstractBoundaries.length; idx++) {
    const current = nonAbstractBoundaries[idx]!;
    const nextLineIndex =
      idx + 1 < nonAbstractBoundaries.length
        ? nonAbstractBoundaries[idx + 1]!.lineIndex
        : endScanLine;

    // 节文本 = 标题行的下一行到下一个标题行之前
    const sectionLines = lines.slice(current.lineIndex + 1, nextLineIndex);
    const text = sectionLines.join('\n').trim();

    if (text.length > 0) {
      // §2.6: 同 SectionLabel 出现多次时合并
      const existing = sectionMap.get(current.label);
      if (existing) {
        sectionMap.set(current.label, existing + '\n\n' + text);
      } else {
        sectionMap.set(current.label, text);
      }
    }
  }

  // 无节标题论文的降级处理
  if (sectionMap.size === 0) {
    sectionMap.set('unknown', fullText.trim());
    boundaries.push({
      lineIndex: 0,
      label: 'unknown',
      title: '',
      type: null,
    });
  }

  return { sectionMap, boundaries };
}
