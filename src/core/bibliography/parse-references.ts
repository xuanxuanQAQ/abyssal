// ═══ 参考文献结构化解析 ═══
// §6: 正则降级实现（AnyStyle.js 无成熟 npm 包）
//
// TODO: 未来可引入 AnyStyle 的 WASM 编译或 REST 服务替代正则降级。
// 当前实现使用多正则提取 + 置信度估算，精度低于 CRF 模型。

import type { AnystyleParsedEntry } from '../types/bibliography';
import { normalizeDoi } from '../search/paper-id';

// ─── 正则 ───

const DOI_RE = /\b(10\.\d{4,9}\/\S+)/;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;
const VOLUME_RE = /\b(\d+)\s*\(\d+\)/; // "12(3)" 模式
const ISSUE_RE = /\((\d+)\)/;
const PAGES_RE = /\b(\d+)\s*[-–—]\s*(\d+)\b/;

// ─── 清理 DOI 尾部标点 ───

function cleanDoi(doi: string): string {
  return doi.replace(/[.,;:)\]}>]+$/, '');
}

// ─── §6.2 parseReferences ───

export function parseReferences(
  rawTexts: string[],
): AnystyleParsedEntry[] {
  return rawTexts.map((rawText) => {
    // DOI
    const doiMatch = DOI_RE.exec(rawText);
    const doi = doiMatch ? normalizeDoi(cleanDoi(doiMatch[1]!)) : null;

    // Year
    const yearMatch = YEAR_RE.exec(rawText);
    const year = yearMatch ? parseInt(yearMatch[1]!, 10) : null;

    // Authors: 年份之前的部分
    let authors: string[] | null = null;
    let title: string | null = null;

    if (yearMatch && yearMatch.index !== undefined && yearMatch.index > 0) {
      const beforeYear = rawText.slice(0, yearMatch.index).trim().replace(/[,.\s]+$/, '');
      if (beforeYear.length > 2) {
        // 简单拆分：按 ", " 或 " and " 或 " & " 分割
        authors = beforeYear
          .split(/,\s+(?=[A-Z])|\s+and\s+|\s+&\s+/i)
          .map((a) => a.trim())
          .filter((a) => a.length > 2);
        if (authors.length === 0) authors = null;
      }

      // Title: 年份后到期刊/DOI 之前
      const afterYear = rawText.slice(yearMatch.index + yearMatch[0].length).trim();
      const cleaned = afterYear.replace(/^[).\s,]+/, '');
      const titleEnd = cleaned.search(/\.\s|10\.\d{4}/);
      title = titleEnd > 0 ? cleaned.slice(0, titleEnd).trim() : cleaned.slice(0, 200).trim();
      // 去除首尾引号
      title = title.replace(/^["'""'']+|["'""'']+$/g, '').trim();
      if (title.length < 5) title = null;
    }

    // Volume
    const volMatch = VOLUME_RE.exec(rawText);
    const volume = volMatch ? volMatch[1]! : null;

    // Issue
    const issueMatch = ISSUE_RE.exec(rawText);
    const issue = issueMatch ? issueMatch[1]! : null;

    // Pages
    const pagesMatch = PAGES_RE.exec(rawText);
    const pages = pagesMatch ? `${pagesMatch[1]}-${pagesMatch[2]}` : null;

    // Journal: 在年份和 volume 之间的斜体文本区域（粗略提取）
    let journal: string | null = null;
    if (yearMatch && volMatch) {
      const between = rawText.slice(
        yearMatch.index + yearMatch[0].length,
        volMatch.index,
      );
      // 取最后一个逗号/句号后的部分
      const parts = between.split(/[.,]\s*/);
      const candidate = parts[parts.length - 1]?.trim();
      if (candidate && candidate.length > 3 && candidate.length < 100) {
        journal = candidate;
      }
    }

    // Type 推断
    let type: AnystyleParsedEntry['type'] = 'unknown';
    if (journal || volume) type = 'journal';

    // Publisher
    const publisher: string | null = null; // 正则难以准确提取

    // §6.2.2 置信度
    const fields = [authors, title, year, journal, volume, pages, publisher];
    const nonNull = fields.filter((f) => f != null).length;
    const confidence = nonNull / 7;

    return {
      rawText,
      authors,
      title,
      year,
      journal,
      volume,
      issue,
      pages,
      publisher,
      doi,
      type,
      confidence,
    };
  });
}
