// ═══ 引文替换管线 ═══
// §7: 扫描 [@id] → citeproc 渲染 → 参考文献列表 + 导出管线

import type { PaperId } from '../types/common';
import type { PaperMetadata } from '../types/paper';
import type { ScanAndReplaceResult } from '../types/bibliography';
import type { CslEngine } from './csl-engine';
import { generateBibtexKey } from './bibtex-key';
import { exportBibtex } from './export-bibtex';

// ─── §7.2 引用标记正则 ───
// Fix #3: 兼容 Pandoc 语法 — 支持定位符 [@id, p.23] 和多引用 [@id1; @id2]

/** 匹配完整的引用括号 [...] 内含 @id */
const CITE_BRACKET_RE = /\[([^\]]*@[a-f0-9]{12}[^\]]*)\]/g;

/** 从括号内容提取单个引用项 */
const CITE_ITEM_RE = /@([a-f0-9]{12})(?:,\s*([^\];]+))?/g;

/** 简化版：仅匹配 [@id]（向后兼容 + LaTeX/Pandoc 导出用） */
const CITE_RE = /@([a-f0-9]{12})/g;

// ─── §7.2 scanAndReplace ───

export function scanAndReplace(
  markdown: string,
  paperMap: Map<PaperId, PaperMetadata>,
  engine: CslEngine,
): ScanAndReplaceResult {
  // §7.2 步骤 1: 扫描引用标记（Pandoc 兼容 — 支持定位符和多引用）
  const citedIds: PaperId[] = [];
  const citedIdSet = new Set<string>();

  // 扫描括号级别的引用 [... @id ... ]
  interface CiteBracket {
    start: number;
    end: number;
    items: Array<{ id: PaperId; locator: string | null }>;
  }
  const brackets: CiteBracket[] = [];
  const bracketRe = new RegExp(CITE_BRACKET_RE.source, 'g');
  let bracketMatch: RegExpExecArray | null;

  while ((bracketMatch = bracketRe.exec(markdown)) !== null) {
    const inner = bracketMatch[1]!;
    const items: CiteBracket['items'] = [];
    const itemRe = new RegExp(CITE_ITEM_RE.source, 'g');
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRe.exec(inner)) !== null) {
      const id = itemMatch[1] as PaperId;
      const locator = itemMatch[2]?.trim() ?? null;
      items.push({ id, locator });
      if (!citedIdSet.has(id)) {
        citedIdSet.add(id);
        citedIds.push(id);
      }
    }

    if (items.length > 0) {
      brackets.push({
        start: bracketMatch.index,
        end: bracketMatch.index + bracketMatch[0].length,
        items,
      });
    }
  }

  if (citedIds.length === 0) {
    return { text: markdown, bibliography: '', citedPaperIds: [] };
  }

  // §7.2 步骤 2-3: 格式化引文
  const papers = citedIds
    .map((id) => {
      const meta = paperMap.get(id);
      return meta ? { paperId: id, metadata: meta } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const formatted = engine.formatCitation(papers);
  const inlineMap = new Map<string, string>();
  for (const f of formatted) {
    inlineMap.set(f.paperId, f.inlineCitation);
  }

  // §7.2 步骤 4: 替换标记（从后向前以保持偏移量）
  // §7.3: 多引用括号内所有 @id 合并为一个引文（由 citeproc cluster 处理）
  let result = markdown;
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i]!;
    // 多引用合并：用分号拼接各引文
    const parts = bracket.items.map((item) => {
      const mapped = inlineMap.get(item.id);
      // Fix: 未在 paperMap 中找到的 ID 保留原始 [@id] 标记而非输出裸 ID
      let cite = mapped ?? `[@${item.id}]`;
      if (item.locator) {
        // Fix #14: 附加定位符——不假设 `)` 结尾，改为追加
        if (cite.endsWith(')')) {
          cite = cite.slice(0, -1) + `, ${item.locator})`;
        } else {
          cite = `${cite}, ${item.locator}`;
        }
      }
      return cite;
    });
    // 如果多个引用在同一括号内，合并（去除重复的括号）
    const merged = parts.length === 1
      ? parts[0]!
      : parts.join('; ');
    result = result.slice(0, bracket.start) + merged + result.slice(bracket.end);
  }

  // §7.2 步骤 5: 参考文献列表
  const bibliography = engine.formatBibliography(papers, 'text');

  return {
    text: result,
    bibliography,
    citedPaperIds: citedIds,
  };
}

// ─── 共用：构建 idToKey 映射 ───

function buildIdToKeyMap(
  paperMap: Map<PaperId, PaperMetadata>,
): { idToKey: Map<string, string>; existingKeys: Set<string> } {
  const existingKeys = new Set<string>();
  const idToKey = new Map<string, string>();
  for (const [id, paper] of paperMap) {
    const key = paper.bibtexKey ?? generateBibtexKey(paper, existingKeys);
    existingKeys.add(key);
    idToKey.set(id, key);
  }
  return { idToKey, existingKeys };
}

// ─── §8.2 LaTeX 导出 ───
// Fix #12: 多引用括号 [@id1; @id2] → \cite{key1,key2}（单条 \cite 命令）

export function exportForLatex(
  markdown: string,
  paperMap: Map<PaperId, PaperMetadata>,
): { tex: string; bib: string } {
  const { idToKey } = buildIdToKeyMap(paperMap);

  // 先处理括号级别的多引用
  const bracketRe = new RegExp(CITE_BRACKET_RE.source, 'g');
  const tex = markdown.replace(bracketRe, (fullMatch, inner: string) => {
    const itemRe = new RegExp(CITE_ITEM_RE.source, 'g');
    const keys: string[] = [];
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRe.exec(inner)) !== null) {
      const id = itemMatch[1]!;
      keys.push(idToKey.get(id) ?? id);
    }
    if (keys.length === 0) return fullMatch;
    return `\\cite{${keys.join(',')}}`;
  });

  const papers = [...paperMap.values()];
  const bib = exportBibtex(papers);

  return { tex, bib };
}

// ─── §8.3 Pandoc Markdown 导出 ───
// Fix #13: 多引用括号 [@id1; @id2] → [@key1; @key2]（保留 Pandoc 语法）

export function exportForPandoc(
  markdown: string,
  paperMap: Map<PaperId, PaperMetadata>,
): { md: string; bib: string } {
  const { idToKey } = buildIdToKeyMap(paperMap);

  // 处理括号级别的多引用，保留定位符
  const bracketRe = new RegExp(CITE_BRACKET_RE.source, 'g');
  const md = markdown.replace(bracketRe, (fullMatch, inner: string) => {
    const itemRe = new RegExp(CITE_ITEM_RE.source, 'g');
    const parts: string[] = [];
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRe.exec(inner)) !== null) {
      const id = itemMatch[1]!;
      const locator = itemMatch[2]?.trim();
      const key = idToKey.get(id) ?? id;
      parts.push(locator ? `@${key}, ${locator}` : `@${key}`);
    }
    if (parts.length === 0) return fullMatch;
    return `[${parts.join('; ')}]`;
  });

  const papers = [...paperMap.values()];
  const bib = exportBibtex(papers);

  return { md, bib };
}
