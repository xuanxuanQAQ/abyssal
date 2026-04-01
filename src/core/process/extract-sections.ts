// ═══ 启发式结构识别 ═══
// §2: 正则三层 + Abstract 特殊处理 + 关键词→SectionLabel 映射
//
// 改进：
//   - Fix #6: styledByLineIndex 替代 styledByText，消除重复行碰撞
//   - Fix #7: 多级标题 depth 计算，子节不再触发同 label 合并
//   - Fix #8: Abstract 终止判定使用 detectHeading 做字体验证
//   - Fix #9: References 搜索阈值从 0.7 降到 0.4（两轮扫描）
//   - Fix #1-prerequisite: 输出 charStart/charEnd 偏移量

import type {
  SectionLabel,
  SectionType,
  SectionMap,
  SectionEntry,
  SectionMapV2,
  SectionBoundary,
  SectionBoundaryList,
} from '../types/chunk';
import type { StyledLine } from '../types';
import type { DocumentStructure, DocumentSection } from '../dla/types';
import type { Logger } from '../infra/logger';

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

// 允许可选的章节编号前缀（如 "7. References", "V. REFERENCES", "第五章 参考文献"）
const REFERENCES_RE = /^(?:(?:\d+|[IVXLC]+)[\.\s)\-:]\s*|(?:第.{1,3}[章节]\s*)|(?:chapter\s+\d+[\.\s:]\s*))?(?:references|bibliography|参考文献|works?\s+cited|references?\s+cited)\s*$/i;
const APPENDIX_RE = /^(?:appendix|appendices|附录)\s*([A-Z]|\d+)?\.?\s*(.*)/i;

// ─── 行号→字符偏移累计数组 ───

/** 构建每行在 fullText 中的起始字符偏移 */
function buildLineCharOffsets(lines: string[]): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    offsets.push(offsets[i]! + lines[i]!.length + 1); // +1 for '\n'
  }
  return offsets;
}

// ─── Fix #6: 行号→StyledLine 映射（替代旧的文本碰撞方案） ───

/**
 * 通过顺序匹配 styledLines 与 lines 数组建立行号→StyledLine 的对应关系。
 * styledLines 按页面顺序排列且跳过空行，lines 是 fullText.split('\n') 的结果。
 * 使用双指针顺序匹配，O(n) 摊销。
 */
function buildStyledByLineIndex(
  lines: string[],
  styledLines: StyledLine[],
): Map<number, StyledLine> {
  const result = new Map<number, StyledLine>();
  let styledIdx = 0;

  for (let lineIdx = 0; lineIdx < lines.length && styledIdx < styledLines.length; lineIdx++) {
    const lineTrimmed = lines[lineIdx]!.trim();
    if (lineTrimmed.length === 0) continue;

    const sl = styledLines[styledIdx]!;
    const slTrimmed = sl.text.trim();

    if (lineTrimmed === slTrimmed) {
      result.set(lineIdx, sl);
      styledIdx++;
    } else if (slTrimmed.length > 0 && lineTrimmed.includes(slTrimmed)) {
      // 部分匹配（styledLine 是行的子串，可能因分割方式不同）
      result.set(lineIdx, sl);
      styledIdx++;
    } else if (slTrimmed.length > 0 && slTrimmed.includes(lineTrimmed)) {
      // 反向部分匹配
      result.set(lineIdx, sl);
      styledIdx++;
    }
    // 不匹配时 lineIdx 前进，styledIdx 不动
  }

  return result;
}

// ─── Fix #7: 标题层级深度 ───

function computeHeadingDepth(title: string): number {
  const m = NUMBERED_RE.exec(title.trim());
  if (m && m[1]) {
    return m[1].split('.').length;
  }
  // 全大写和罗马数字视为顶层
  return 1;
}

// ─── §2.3 Abstract 提取（Fix #8: 使用 detectHeading 做字体验证） ───

function extractAbstract(
  lines: string[],
  totalLines: number,
  styledByLineIndex: Map<number, StyledLine>,
  baselineFontSize: number,
): { text: string; endLine: number } | null {
  const searchLimit = Math.ceil(totalLines * 0.2);

  for (let i = 0; i < Math.min(searchLimit, lines.length); i++) {
    const line = lines[i]!.trim();

    // 独立行 "Abstract"
    if (/^abstract\s*$/i.test(line)) {
      const textLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        // Fix #8: 使用 detectHeading 代替裸正则，防止 Abstract 内编号列表误截断
        const heading = detectHeading(
          lines[j]!, j, styledByLineIndex.get(j), baselineFontSize,
        );
        if (heading) {
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
        // Fix #8
        const heading = detectHeading(
          lines[j]!, j, styledByLineIndex.get(j), baselineFontSize,
        );
        if (heading) {
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
// 结合字体元数据过滤误报。真正的节标题通常满足
// (正则匹配) AND (字体大于正文基准 OR 字体加粗)。

interface RawHeading {
  lineIndex: number;
  title: string;
  depth: number; // Fix #7: 标题层级深度
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

  const depth = computeHeadingDepth(trimmed);
  return { lineIndex, title: trimmed, depth };
}

// ─── Fix #9: References 区域定位（两轮扫描） ───

function findReferencesLine(lines: string[]): number | null {
  // 第一轮：从末尾到 70%
  for (let i = lines.length - 1; i >= Math.floor(lines.length * 0.7); i--) {
    if (REFERENCES_RE.test(lines[i]!.trim())) {
      return i;
    }
  }
  // 第二轮：从 70% 到 40%（覆盖短论文）
  for (let i = Math.floor(lines.length * 0.7) - 1; i >= Math.floor(lines.length * 0.4); i--) {
    if (i >= 0 && REFERENCES_RE.test(lines[i]!.trim())) {
      return i;
    }
  }
  return null;
}

// ─── §2.1 extractSections 主函数 ───

export interface ExtractSectionsResult {
  sectionMap: SectionMap;
  /** V2 版本带偏移量的节映射 */
  sectionMapV2: SectionMapV2;
  boundaries: SectionBoundaryList;
}

/**
 * @param styledLines 带字体元数据的行列表（来自 extractText）。
 *   提供时会用字体大小/粗体过滤正则误报；不提供时回退到仅正则。
 */
export function extractSections(
  fullText: string,
  styledLines?: StyledLine[],
  logger?: Logger | null,
): ExtractSectionsResult {
  const t0 = Date.now();
  const lines = fullText.split('\n');
  const lineCharOffsets = buildLineCharOffsets(lines);
  const boundaries: SectionBoundaryList = [];

  // Fix #6: 行号→StyledLine 映射（替代旧的文本碰撞方案）
  const styledByLineIndex = styledLines
    ? buildStyledByLineIndex(lines, styledLines)
    : new Map<number, StyledLine>();
  const baselineFontSize = styledLines ? computeBaselineFontSize(styledLines) : 0;

  const sectionMap: SectionMap = new Map();
  const sectionMapV2: SectionMapV2 = new Map();

  // §2.3: Abstract 特殊提取（Fix #8: 传入 styledByLineIndex + baselineFontSize）
  const abstractResult = extractAbstract(lines, lines.length, styledByLineIndex, baselineFontSize);
  if (abstractResult && abstractResult.text.trim().length > 0) {
    const abstractText = abstractResult.text.trim();
    // 计算 abstract 在 fullText 中的偏移
    const abstractCharStart = fullText.indexOf(abstractText);
    const abstractCharEnd = abstractCharStart >= 0
      ? abstractCharStart + abstractText.length
      : 0;

    boundaries.push({
      lineIndex: 0,
      label: 'abstract',
      title: 'Abstract',
      type: 'introduction',
      charStart: abstractCharStart >= 0 ? abstractCharStart : 0,
      charEnd: abstractCharEnd,
      depth: 1,
    });
    sectionMap.set('abstract', abstractText);
    sectionMapV2.set('abstract', {
      text: abstractText,
      charStart: abstractCharStart >= 0 ? abstractCharStart : 0,
      charEnd: abstractCharEnd,
    });
  }

  // 扫描节标题
  const startLine = abstractResult?.endLine ?? 0;

  // Fix #9: References 区域定位（两轮扫描，覆盖短论文）
  const referencesStartLine = findReferencesLine(lines);
  const endScanLine = referencesStartLine ?? lines.length;

  // 记录上一个顶层标题的 label，用于 Fix #7 子节处理
  let lastTopLevelLabel: SectionLabel | null = null;

  for (let i = startLine; i < endScanLine; i++) {
    const lineText = lines[i]!;
    // Fix #6: 使用 styledByLineIndex 代替 styledByText
    const styledLine = styledByLineIndex.get(i);
    const heading = detectHeading(lineText, i, styledLine, baselineFontSize);
    if (heading) {
      const label = classifyTitle(heading.title);

      // 跳过 abstract（已单独处理）
      if (label === 'abstract') continue;

      // Fix #7: 深层子节（depth >= 2）且与父节同 label 时不作为独立 boundary
      // 而是在后续切分中保留为段落分隔
      if (heading.depth >= 2 && label === lastTopLevelLabel) {
        continue;
      }

      // Appendix 检测
      if (APPENDIX_RE.test(heading.title)) {
        boundaries.push({
          lineIndex: i,
          label: 'appendix',
          title: heading.title,
          type: 'methods',
          depth: heading.depth,
        });
        if (heading.depth <= 1) lastTopLevelLabel = 'appendix';
        continue;
      }

      boundaries.push({
        lineIndex: i,
        label,
        title: heading.title,
        type: LABEL_TO_TYPE[label],
        depth: heading.depth,
      });

      if (heading.depth <= 1) {
        lastTopLevelLabel = label;
      }
    }
  }

  // §2.5: 节边界切分 + charStart/charEnd 计算
  const nonAbstractBoundaries = boundaries.filter((b) => b.label !== 'abstract');

  for (let idx = 0; idx < nonAbstractBoundaries.length; idx++) {
    const current = nonAbstractBoundaries[idx]!;
    const nextLineIndex =
      idx + 1 < nonAbstractBoundaries.length
        ? nonAbstractBoundaries[idx + 1]!.lineIndex
        : endScanLine;

    // 节文本 = 标题行的下一行到下一个标题行之前
    const contentStartLine = current.lineIndex + 1;
    const sectionLines = lines.slice(contentStartLine, nextLineIndex);
    const text = sectionLines.join('\n').trim();

    // 计算 charStart/charEnd
    const charStart = contentStartLine < lineCharOffsets.length
      ? lineCharOffsets[contentStartLine]!
      : fullText.length;
    const charEnd = nextLineIndex < lineCharOffsets.length
      ? lineCharOffsets[nextLineIndex]!
      : fullText.length;

    // 更新 boundary 的 charStart/charEnd
    current.charStart = charStart;
    current.charEnd = charEnd;

    if (text.length > 0) {
      // §2.6: 同 SectionLabel 出现多次时合并（仅顶层同 label 才合并）
      const existing = sectionMap.get(current.label);
      const existingV2 = sectionMapV2.get(current.label);
      if (existing && existingV2) {
        sectionMap.set(current.label, existing + '\n\n' + text);
        sectionMapV2.set(current.label, {
          text: existing + '\n\n' + text,
          charStart: existingV2.charStart,
          charEnd: charEnd,
        });
      } else {
        sectionMap.set(current.label, text);
        sectionMapV2.set(current.label, { text, charStart, charEnd });
      }
    }
  }

  // 无节标题论文的降级处理
  if (sectionMap.size === 0) {
    sectionMap.set('unknown', fullText.trim());
    sectionMapV2.set('unknown', {
      text: fullText.trim(),
      charStart: 0,
      charEnd: fullText.length,
    });
    boundaries.push({
      lineIndex: 0,
      label: 'unknown',
      title: '',
      type: null,
      charStart: 0,
      charEnd: fullText.length,
      depth: 1,
    });
  }

  logger?.info('[extractSections] Section detection complete (regex path)', {
    sections: sectionMap.size,
    labels: Array.from(sectionMap.keys()),
    boundaries: boundaries.length,
    hasAbstract: sectionMap.has('abstract'),
    hasStyledLines: !!styledLines,
    referencesLine: referencesStartLine,
    durationMs: Date.now() - t0,
  });

  return { sectionMap, sectionMapV2, boundaries };
}

// ═══ Layout-first section detection (DLA path) ═══

/**
 * Build section boundaries and maps from a DLA DocumentStructure.
 *
 * This replaces regex-based heading detection with visual block-level
 * title detection from the DLA pipeline. Falls back to 'unknown' when
 * the structure contains no sections.
 */
export function extractSectionsFromLayout(
  structure: DocumentStructure,
  fullText: string,
  logger?: Logger | null,
): ExtractSectionsResult {
  const boundaries: SectionBoundaryList = [];
  const sectionMap: SectionMap = new Map();
  const sectionMapV2: SectionMapV2 = new Map();

  function collectSection(sec: DocumentSection): void {
    const label = sec.label;
    const title = sec.titleBlock.text?.trim() ?? '';
    const depth = sec.depth;

    // Gather body text from bodyBlocks in reading order
    const bodyText = sec.bodyBlocks
      .filter((b) => b.text != null)
      .map((b) => b.text!)
      .join('\n\n')
      .trim();

    // Compute char offsets from all blocks in section
    const allBlocks = [sec.titleBlock, ...sec.bodyBlocks];
    const validStarts = allBlocks
      .filter((b) => b.charStart != null)
      .map((b) => b.charStart!);
    const validEnds = allBlocks
      .filter((b) => b.charEnd != null)
      .map((b) => b.charEnd!);
    const charStart =
      validStarts.length > 0 ? Math.min(...validStarts) : 0;
    const charEnd =
      validEnds.length > 0 ? Math.max(...validEnds) : fullText.length;

    const type = LABEL_TO_TYPE[label];

    boundaries.push({
      lineIndex: sec.titleBlock.readingOrder,
      label,
      title,
      type,
      charStart,
      charEnd,
      depth,
    });

    if (bodyText.length > 0) {
      const existing = sectionMap.get(label);
      const existingV2 = sectionMapV2.get(label);
      if (existing && existingV2) {
        sectionMap.set(label, existing + '\n\n' + bodyText);
        sectionMapV2.set(label, {
          text: existing + '\n\n' + bodyText,
          charStart: existingV2.charStart,
          charEnd,
        });
      } else {
        sectionMap.set(label, bodyText);
        sectionMapV2.set(label, { text: bodyText, charStart, charEnd });
      }
    }

    // Recurse into children
    for (const child of sec.children) {
      collectSection(child);
    }
  }

  for (const sec of structure.sections) {
    collectSection(sec);
  }

  // Fallback: no sections detected
  if (sectionMap.size === 0) {
    sectionMap.set('unknown', fullText.trim());
    sectionMapV2.set('unknown', {
      text: fullText.trim(),
      charStart: 0,
      charEnd: fullText.length,
    });
    boundaries.push({
      lineIndex: 0,
      label: 'unknown',
      title: '',
      type: null,
      charStart: 0,
      charEnd: fullText.length,
      depth: 1,
    });
  }

  logger?.info('[extractSections] Section detection complete (DLA path)', {
    sections: sectionMap.size,
    labels: Array.from(sectionMap.keys()),
    boundaries: boundaries.length,
    inputSections: structure.sections.length,
  });

  return { sectionMap, sectionMapV2, boundaries };
}
