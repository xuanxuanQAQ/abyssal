// ═══ 结构感知摘要压缩 ═══
// §7: 固定保留部分 + 权重分配 + 节内裁剪

import type { SectionLabel, SectionMap, SectionType } from '../types/chunk';
import { countTokens } from '../infra/token-counter';

// ─── §7.2 SectionType 权重 ───

const SECTION_WEIGHTS: Record<SectionType, number> = {
  introduction: 1.0,
  results: 1.0,
  discussion: 0.9,
  methods: 0.8,
  conclusion: 0.7,
  literature_review: 0.5,
  theory: 0.6,
};

const DEFAULT_WEIGHT = 0.5;

// ─── SectionLabel → SectionType（用于权重查找） ───

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

function getWeight(label: SectionLabel): number {
  const type = LABEL_TO_TYPE[label];
  return type ? (SECTION_WEIGHTS[type] ?? DEFAULT_WEIGHT) : DEFAULT_WEIGHT;
}

// ─── 段落分割 ───

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

// ─── §7.1 compressForContext 主函数 ───

export function compressForContext(
  sectionMap: SectionMap,
  targetTokens: number,
): string {
  const parts: Array<{ label: SectionLabel; title: string; text: string }> = [];

  // §7.2 步骤 1：固定保留部分
  let fixedTokens = 0;
  const sectionData: Array<{
    label: SectionLabel;
    title: string;
    firstPara: string;
    lastPara: string;
    middleParas: string[];
    middleTokens: number;
  }> = [];

  for (const [label, text] of sectionMap) {
    const title = label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const paragraphs = splitParagraphs(text);

    if (label === 'abstract') {
      // Abstract 全文保留
      fixedTokens += countTokens(text);
      parts.push({ label, title, text });
      continue;
    }

    if (paragraphs.length === 0) continue;

    const firstPara = paragraphs[0]!;
    const lastPara = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1]! : '';
    const middleParas = paragraphs.length > 2 ? paragraphs.slice(1, -1) : [];

    fixedTokens += countTokens(firstPara);
    if (lastPara) fixedTokens += countTokens(lastPara);

    const middleTokens = middleParas.reduce(
      (sum, p) => sum + countTokens(p),
      0,
    );

    sectionData.push({
      label,
      title,
      firstPara,
      lastPara,
      middleParas,
      middleTokens,
    });
  }

  // §7.2 步骤 2：计算剩余预算
  const remainingBudget = targetTokens - fixedTokens;

  if (remainingBudget <= 0) {
    // 仅保留固定部分
    for (const sd of sectionData) {
      const text = sd.lastPara
        ? `${sd.firstPara}\n\n[... content omitted from ${sd.title} ...]\n\n${sd.lastPara}`
        : sd.firstPara;
      parts.push({ label: sd.label, title: sd.title, text });
    }
  } else {
    // §7.2 步骤 3：按权重分配中间段落预算
    const totalWeightedTokens = sectionData.reduce(
      (sum, sd) => sum + getWeight(sd.label) * sd.middleTokens,
      0,
    );

    for (const sd of sectionData) {
      if (sd.middleParas.length === 0) {
        // 无中间段落
        const text = sd.lastPara
          ? `${sd.firstPara}\n\n${sd.lastPara}`
          : sd.firstPara;
        parts.push({ label: sd.label, title: sd.title, text });
        continue;
      }

      // 分配预算
      const budget =
        totalWeightedTokens > 0
          ? Math.floor(
              (getWeight(sd.label) * sd.middleTokens * remainingBudget) /
                totalWeightedTokens,
            )
          : 0;

      if (sd.middleTokens <= budget) {
        // 中间段落全部保留
        const allText = [sd.firstPara, ...sd.middleParas, sd.lastPara]
          .filter(Boolean)
          .join('\n\n');
        parts.push({ label: sd.label, title: sd.title, text: allText });
      } else {
        // §7.2 步骤 4：从前向后保留段落直到预算耗尽
        const kept: string[] = [sd.firstPara];
        let usedTokens = 0;
        let omittedTokens = 0;

        for (const para of sd.middleParas) {
          const paraTokens = countTokens(para);
          if (usedTokens + paraTokens <= budget) {
            kept.push(para);
            usedTokens += paraTokens;
          } else {
            omittedTokens += paraTokens;
          }
        }

        if (omittedTokens > 0) {
          kept.push(`[... ${omittedTokens} tokens omitted from ${sd.title} ...]`);
        }

        if (sd.lastPara) kept.push(sd.lastPara);

        parts.push({
          label: sd.label,
          title: sd.title,
          text: kept.join('\n\n'),
        });
      }
    }
  }

  // §7.2 步骤 5：组装输出
  return parts
    .map((p) => `## ${p.title}\n\n${p.text}`)
    .join('\n\n');
}
