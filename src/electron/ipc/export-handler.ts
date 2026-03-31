/**
 * export-handler — Full export pipeline for articles.
 *
 * Supports Markdown and LaTeX export with:
 * - Citation replacement (inline markers → formatted citations)
 * - Reference list generation
 * - Section hierarchy → heading levels
 * - Progress reporting via push channel
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { AppContext } from '../app-context';
import type { ExportFormat, CitationStyle } from '../../shared-types/enums';
import type { ExportProgress, FullDocumentSection } from '../../shared-types/models';

interface ExportOptions {
  articleId: string;
  format: ExportFormat;
  citationStyle?: CitationStyle;
}

interface PaperInfo {
  id: string;
  title: string;
  authors: Array<{ name: string }>;
  year: number;
}

/**
 * Export an article to the specified format.
 * Returns the output file path.
 */
export async function exportArticle(
  ctx: AppContext,
  options: ExportOptions,
): Promise<string> {
  const { articleId, format, citationStyle = 'APA' } = options;
  const { logger } = ctx;

  const emitProgress = (stage: ExportProgress['stage'], progress: number, message: string) => {
    ctx.pushManager?.pushExportProgress({ stage, progress, message });
  };

  // ── 1. Load article data ──
  emitProgress('assembling', 10, '正在加载文档…');

  const article = (await ctx.dbProxy.getArticle(articleId as any)) as Record<string, unknown> | null;
  if (!article) throw new Error('Article not found');

  const title = (article['title'] as string) ?? 'Untitled';

  // Load full document sections
  let sections: FullDocumentSection[];
  try {
    const fullDoc = (await (ctx.dbProxy as any).getFullDocument(articleId)) as any;
    sections = (fullDoc?.sections ?? []) as FullDocumentSection[];
  } catch {
    // Fallback: build from outline
    const outlineSections = (article['sections'] as Array<Record<string, unknown>>) ?? [];
    sections = flattenSections(outlineSections);
  }

  emitProgress('assembling', 30, '文档加载完成');

  // ── 2. Collect citation IDs ──
  emitProgress('formatting_citations', 40, '正在处理引文…');

  const citationIds = new Set<string>();
  const citationRegex = /\[@([a-zA-Z0-9_-]+)\]/g;

  for (const sec of sections) {
    const text = sec.content || '';
    let match: RegExpExecArray | null;
    citationRegex.lastIndex = 0;
    while ((match = citationRegex.exec(text)) !== null) {
      if (match[1]) citationIds.add(match[1]);
    }
    // Also scan documentJson
    if (sec.documentJson) {
      const djStr = sec.documentJson;
      citationRegex.lastIndex = 0;
      while ((match = citationRegex.exec(djStr)) !== null) {
        if (match[1]) citationIds.add(match[1]);
      }
    }
  }

  // Load paper metadata for cited papers
  const papers = new Map<string, PaperInfo>();
  for (const pid of citationIds) {
    try {
      const paper = (await ctx.dbProxy.getPaper(pid as any)) as Record<string, unknown> | null;
      if (paper) {
        papers.set(pid, {
          id: pid,
          title: (paper['title'] as string) ?? '',
          authors: parsePaperAuthors(paper['authors']),
          year: (paper['year'] as number) ?? 0,
        });
      }
    } catch {
      // Paper not found — will show placeholder
    }
  }

  emitProgress('formatting_citations', 60, `已处理 ${papers.size} 条引文`);

  // ── 3. Generate export content ──
  emitProgress('converting', 70, '正在生成导出内容…');

  let content: string;
  let ext: string;

  if (format === 'latex') {
    content = generateLaTeX(title, sections, papers, citationStyle, article);
    ext = 'tex';
  } else {
    // Markdown (also used as base for docx/pdf)
    content = generateMarkdown(title, sections, papers, citationStyle);
    ext = 'md';
  }

  emitProgress('writing', 90, '正在写入文件…');

  // ── 4. Write output ──
  const exportDir = path.join(ctx.workspaceRoot, 'exports');
  await fs.mkdir(exportDir, { recursive: true });

  const safeName = title.replace(/[/\\?%*:|"<>]/g, '_');
  const exportPath = path.join(exportDir, `${safeName}.${ext}`);
  await fs.writeFile(exportPath, content, 'utf-8');

  emitProgress('writing', 100, '导出完成');
  logger.info('Article exported', { articleId, format, exportPath });

  return exportPath;
}

// ── Markdown generation ──

function generateMarkdown(
  title: string,
  sections: FullDocumentSection[],
  papers: Map<string, PaperInfo>,
  citationStyle: CitationStyle,
): string {
  const lines: string[] = [`# ${title}`, ''];

  // Build hierarchy and render
  const roots = buildHierarchy(sections);
  renderMarkdownSections(roots, 1, lines, papers, citationStyle);

  // Generate reference list
  const refList = generateReferenceListMarkdown(sections, papers, citationStyle);
  if (refList) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(refList);
  }

  return lines.join('\n');
}

function renderMarkdownSections(
  sections: HierarchicalSection[],
  depth: number,
  lines: string[],
  papers: Map<string, PaperInfo>,
  citationStyle: CitationStyle,
): void {
  for (const sec of sections) {
    const heading = '#'.repeat(Math.min(depth + 1, 6));
    lines.push(`${heading} ${sec.title || '未命名节'}`);
    lines.push('');

    // Prefer documentJson, fall back to content
    const sectionText = getSectionPlainText(sec);
    if (sectionText) {
      const processed = replaceCitations(sectionText, papers, citationStyle);
      lines.push(processed);
      lines.push('');
    }

    if (sec.children.length > 0) {
      renderMarkdownSections(sec.children, depth + 1, lines, papers, citationStyle);
    }
  }
}

/** Extract plain text from a section, preferring documentJson over content */
function getSectionPlainText(sec: FullDocumentSection): string {
  if (sec.documentJson) {
    try {
      const parsed = JSON.parse(sec.documentJson);
      return extractTextFromJson(parsed);
    } catch {
      // fall through
    }
  }
  return sec.content ?? '';
}

/** Recursively extract text from ProseMirror JSON */
function extractTextFromJson(node: Record<string, unknown>): string {
  if (typeof node['text'] === 'string') {
    return node['text'];
  }

  const content = node['content'] as Array<Record<string, unknown>> | undefined;
  if (!content || !Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const child of content) {
    const type = child['type'] as string;

    if (type === 'paragraph') {
      const text = extractTextFromJson(child);
      if (text) parts.push(text);
    } else if (type === 'heading') {
      const text = extractTextFromJson(child);
      if (text) parts.push(text);
    } else if (type === 'citationNode') {
      const paperId = (child['attrs'] as any)?.paperId ?? '';
      parts.push(`[@${paperId}]`);
    } else if (type === 'mathInline') {
      const latex = (child['attrs'] as any)?.latex ?? '';
      parts.push(`$${latex}$`);
    } else if (type === 'mathBlock') {
      const latex = (child['attrs'] as any)?.latex ?? '';
      parts.push(`$$${latex}$$`);
    } else if (type === 'text') {
      parts.push((child['text'] as string) ?? '');
    } else {
      // Recurse for other block types
      const text = extractTextFromJson(child);
      if (text) parts.push(text);
    }
  }

  // Add paragraph breaks between top-level blocks
  if (node['type'] === 'doc') {
    return parts.join('\n\n');
  }
  return parts.join('');
}

// ── LaTeX generation ──

function generateLaTeX(
  title: string,
  sections: FullDocumentSection[],
  papers: Map<string, PaperInfo>,
  citationStyle: CitationStyle,
  article: Record<string, unknown>,
): string {
  const lines: string[] = [];

  // Preamble
  lines.push('\\documentclass{article}');
  lines.push('');
  lines.push('\\usepackage[utf8]{inputenc}');
  lines.push('\\usepackage[T1]{fontenc}');
  lines.push('\\usepackage{amsmath,amssymb,amsfonts}');
  lines.push('\\usepackage{graphicx}');
  lines.push('\\usepackage{hyperref}');
  lines.push('\\usepackage{booktabs}');
  lines.push('\\usepackage{listings}');
  lines.push('\\usepackage{xcolor}');
  lines.push('');

  lines.push(`\\title{${escapeLatex(title)}}`);

  // Authors
  const authors = parseArticleAuthors(article['authors']);
  if (authors.length > 0) {
    const authorStr = authors.map((a) => escapeLatex(a)).join(' \\and ');
    lines.push(`\\author{${authorStr}}`);
  }

  lines.push('\\date{}');
  lines.push('');
  lines.push('\\begin{document}');
  lines.push('\\maketitle');

  // Abstract
  const abstract = (article['abstract'] as string) ?? '';
  if (abstract) {
    lines.push('');
    lines.push('\\begin{abstract}');
    lines.push(escapeLatex(abstract));
    lines.push('\\end{abstract}');
  }

  // Keywords
  const keywords = parseKeywords(article['keywords']);
  if (keywords.length > 0) {
    lines.push('');
    lines.push(`\\textbf{Keywords:} ${keywords.map(escapeLatex).join(', ')}`);
  }

  lines.push('');

  // Sections
  const roots = buildHierarchy(sections);
  renderLaTeXSections(roots, 0, lines, papers);

  // Bibliography
  if (papers.size > 0) {
    lines.push('');
    lines.push('\\begin{thebibliography}{99}');
    for (const [id, paper] of papers) {
      const authorStr = paper.authors.map((a) => escapeLatex(a.name)).join(' and ');
      lines.push(
        `\\bibitem{${id}} ${authorStr}. \\textit{${escapeLatex(paper.title)}}. ${paper.year}.`,
      );
    }
    lines.push('\\end{thebibliography}');
  }

  lines.push('');
  lines.push('\\end{document}');

  return lines.join('\n');
}

function renderLaTeXSections(
  sections: HierarchicalSection[],
  depth: number,
  lines: string[],
  papers: Map<string, PaperInfo>,
): void {
  for (const sec of sections) {
    const cmd = latexHeadingCmd(depth);
    lines.push(`${cmd}{${escapeLatex(sec.title || '未命名节')}}`);
    lines.push('');

    const sectionText = getSectionPlainText(sec);
    if (sectionText) {
      // Escape plain text first, then replace citation markers with \cite{}
      const escaped = escapeLatex(sectionText);
      const processed = escaped.replace(
        /\[@([a-zA-Z0-9_-]+)\]/g,
        (_m, id: string) => `\\cite{${id}}`,
      );
      lines.push(processed);
      lines.push('');
    }

    if (sec.children.length > 0) {
      renderLaTeXSections(sec.children, depth + 1, lines, papers);
    }
  }
}

// ── Citation processing ──

function replaceCitations(
  text: string,
  papers: Map<string, PaperInfo>,
  style: CitationStyle,
): string {
  // Build index map for numbered styles
  const ids: string[] = [];
  const seen = new Set<string>();
  const regex = /\[@([a-zA-Z0-9_-]+)\]/g;
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m[1] && !seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  const indexMap = new Map(ids.map((id, i) => [id, i + 1]));

  return text.replace(/\[@([a-zA-Z0-9_-]+)\]/g, (_full, paperId: string) => {
    const paper = papers.get(paperId);
    const idx = indexMap.get(paperId) ?? 0;

    if (!paper) {
      return style === 'IEEE' || style === 'GB/T 7714' ? '[?]' : `(${paperId}, n.d.)`;
    }

    const surname = extractSurname(paper.authors[0]?.name ?? '');

    switch (style) {
      case 'APA':
        if (paper.authors.length > 2) return `(${surname} et al., ${paper.year})`;
        if (paper.authors.length === 2)
          return `(${surname} & ${extractSurname(paper.authors[1]!.name)}, ${paper.year})`;
        return `(${surname}, ${paper.year})`;
      case 'IEEE':
        return `[${idx}]`;
      case 'GB/T 7714':
        return `[${idx}]`;
      case 'Chicago':
        return paper.authors.length > 3
          ? `(${surname} et al. ${paper.year})`
          : `(${surname} ${paper.year})`;
    }
    return _full;
  });
}

function generateReferenceListMarkdown(
  sections: FullDocumentSection[],
  papers: Map<string, PaperInfo>,
  style: CitationStyle,
): string {
  // Collect all citation IDs in order
  const ids: string[] = [];
  const seen = new Set<string>();
  const regex = /\[@([a-zA-Z0-9_-]+)\]/g;

  for (const sec of sections) {
    const text = getSectionPlainText(sec);
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        ids.push(m[1]);
      }
    }
  }

  if (ids.length === 0) return '';

  const header = style === 'GB/T 7714' ? '## 参考文献' : '## References';
  const lines: string[] = [header, ''];

  for (let i = 0; i < ids.length; i++) {
    const paper = papers.get(ids[i]!);
    if (!paper) {
      lines.push(`${i + 1}. [${ids[i]}] Reference not found.`);
      continue;
    }

    const authorStr = paper.authors.map((a) => a.name).join(', ');
    lines.push(`${i + 1}. ${authorStr}. *${paper.title}*. ${paper.year}.`);
  }

  return lines.join('\n');
}

// ── Hierarchy helpers ──

interface HierarchicalSection extends FullDocumentSection {
  children: HierarchicalSection[];
}

function buildHierarchy(sections: FullDocumentSection[]): HierarchicalSection[] {
  const map = new Map<string, HierarchicalSection>();
  const roots: HierarchicalSection[] = [];

  for (const s of sections) {
    map.set(s.sectionId, { ...s, children: [] });
  }

  for (const s of sections) {
    const node = map.get(s.sectionId)!;
    if (s.parentId && map.has(s.parentId)) {
      map.get(s.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortRecursive(nodes: HierarchicalSection[]): void {
    nodes.sort((a, b) => a.sortIndex - b.sortIndex);
    for (const n of nodes) sortRecursive(n.children);
  }
  sortRecursive(roots);

  return roots;
}

function flattenSections(nodes: Array<Record<string, unknown>>, parentId: string | null = null, index = { v: 0 }): FullDocumentSection[] {
  const result: FullDocumentSection[] = [];
  for (const n of nodes) {
    const id = (n['id'] as string) ?? crypto.randomUUID();
    result.push({
      sectionId: id,
      title: (n['title'] as string) ?? '',
      content: (n['content'] as string) ?? '',
      documentJson: (n['documentJson'] as string) ?? null,
      version: 1,
      sortIndex: index.v++,
      parentId,
      depth: 0,
    });
    if (Array.isArray(n['children'])) {
      result.push(...flattenSections(n['children'] as Array<Record<string, unknown>>, id, index));
    }
  }
  return result;
}

// ── Utilities ──

function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

function parsePaperAuthors(raw: unknown): Array<{ name: string }> {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((a) =>
          typeof a === 'string' ? { name: a } : { name: a?.name ?? String(a) },
        );
      }
    } catch {
      return [{ name: raw }];
    }
  }
  if (Array.isArray(raw)) {
    return raw.map((a) =>
      typeof a === 'string' ? { name: a } : { name: (a as any)?.name ?? String(a) },
    );
  }
  return [];
}

function parseArticleAuthors(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((a) => (typeof a === 'string' ? a : a?.name ?? String(a)));
      }
    } catch {
      return [raw];
    }
  }
  if (Array.isArray(raw)) {
    return raw.map((a) => (typeof a === 'string' ? a : (a as any)?.name ?? String(a)));
  }
  return [];
}

function parseKeywords(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.split(',').map((k) => k.trim()).filter(Boolean);
    }
  }
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\x00BACKSLASH\x00')
    .replace(/[&%$#_{}]/g, (ch) => `\\${ch}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\x00BACKSLASH\x00/g, '\\textbackslash{}');
}

function latexHeadingCmd(depth: number): string {
  switch (depth) {
    case 0: return '\\section';
    case 1: return '\\subsection';
    case 2: return '\\subsubsection';
    case 3: return '\\paragraph';
    default: return '\\subparagraph';
  }
}
