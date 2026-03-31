/**
 * latexExporter — Converts ProseMirror JSONContent to LaTeX source.
 *
 * Handles: sections, headings, paragraphs, lists, math, citations,
 * figures, tables, footnotes, cross-references, code blocks, and marks.
 */

import type { JSONContent } from '@tiptap/core';
import type { CitationStyle } from '../../../../shared-types/enums';
import type { PaperInfo } from './citationFormatter';

export interface LaTeXExportOptions {
  documentClass?: string;
  citationStyle: CitationStyle;
  papers: Map<string, PaperInfo>;
  title?: string;
  authors?: Array<{ name: string; affiliation?: string }>;
  abstract?: string;
  keywords?: string[];
}

/**
 * Convert a full ProseMirror document (unified doc > section+ format)
 * to a complete LaTeX document string.
 */
export function exportToLaTeX(
  docJson: JSONContent,
  options: LaTeXExportOptions,
): string {
  const ctx = new LaTeXContext(options);
  const body = serializeNodes(docJson.content ?? [], ctx);

  return buildDocument(body, ctx);
}

// ── Context ──

class LaTeXContext {
  readonly citationStyle: CitationStyle;
  readonly papers: Map<string, PaperInfo>;
  readonly title: string;
  readonly authors: Array<{ name: string; affiliation?: string }>;
  readonly abstract: string;
  readonly keywords: string[];
  readonly documentClass: string;

  /** Ordered citation IDs for numbered styles */
  private citationOrder: string[] = [];
  private citationSet = new Set<string>();

  constructor(options: LaTeXExportOptions) {
    this.citationStyle = options.citationStyle;
    this.papers = options.papers;
    this.title = options.title ?? '';
    this.authors = options.authors ?? [];
    this.abstract = options.abstract ?? '';
    this.keywords = options.keywords ?? [];
    this.documentClass = options.documentClass ?? 'article';
  }

  /** Register a citation and return its 1-based index */
  registerCitation(paperId: string): number {
    if (!this.citationSet.has(paperId)) {
      this.citationSet.add(paperId);
      this.citationOrder.push(paperId);
    }
    return this.citationOrder.indexOf(paperId) + 1;
  }

  getCitationOrder(): string[] {
    return this.citationOrder;
  }
}

// ── Document wrapper ──

function buildDocument(body: string, ctx: LaTeXContext): string {
  const lines: string[] = [];

  lines.push(`\\documentclass{${ctx.documentClass}}`);
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

  if (ctx.title) {
    lines.push(`\\title{${escapeLatex(ctx.title)}}`);
  }
  if (ctx.authors.length > 0) {
    const authorStr = ctx.authors
      .map((a) => {
        if (a.affiliation) {
          return `${escapeLatex(a.name)}\\\\${escapeLatex(a.affiliation)}`;
        }
        return escapeLatex(a.name);
      })
      .join(' \\and ');
    lines.push(`\\author{${authorStr}}`);
  }
  lines.push('\\date{}');
  lines.push('');
  lines.push('\\begin{document}');

  if (ctx.title) {
    lines.push('\\maketitle');
  }

  if (ctx.abstract) {
    lines.push('');
    lines.push('\\begin{abstract}');
    lines.push(escapeLatex(ctx.abstract));
    lines.push('\\end{abstract}');
  }

  if (ctx.keywords.length > 0) {
    lines.push('');
    lines.push(`\\textbf{Keywords:} ${ctx.keywords.map(escapeLatex).join(', ')}`);
  }

  lines.push('');
  lines.push(body);

  // Generate bibliography
  const bibLines = generateBibliography(ctx);
  if (bibLines) {
    lines.push('');
    lines.push(bibLines);
  }

  lines.push('');
  lines.push('\\end{document}');

  return lines.join('\n');
}

function generateBibliography(ctx: LaTeXContext): string {
  const order = ctx.getCitationOrder();
  if (order.length === 0) return '';

  const lines: string[] = [];
  lines.push('\\begin{thebibliography}{99}');

  for (const paperId of order) {
    const paper = ctx.papers.get(paperId);
    if (!paper) {
      lines.push(`\\bibitem{${paperId}} [Reference not found]`);
      continue;
    }

    const authorStr = paper.authors.map((a) => escapeLatex(a.name)).join(' and ');
    lines.push(
      `\\bibitem{${paperId}} ${authorStr}. \\textit{${escapeLatex(paper.title)}}. ${paper.year}.`,
    );
  }

  lines.push('\\end{thebibliography}');
  return lines.join('\n');
}

// ── Node serialization ──

function serializeNodes(nodes: JSONContent[], ctx: LaTeXContext): string {
  return nodes.map((n) => serializeNode(n, ctx)).filter(Boolean).join('\n');
}

function serializeNode(node: JSONContent, ctx: LaTeXContext): string {
  switch (node.type) {
    case 'section': {
      // section wrapper — serialize children
      return serializeNodes(node.content ?? [], ctx);
    }

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1;
      const text = serializeInline(node.content ?? [], ctx);
      const cmd = headingCommand(level);
      return `\n${cmd}{${text}}\n`;
    }

    case 'paragraph': {
      const text = serializeInline(node.content ?? [], ctx);
      return text ? `${text}\n` : '';
    }

    case 'bulletList': {
      const items = (node.content ?? [])
        .map((item) => {
          const inner = serializeListItem(item, ctx);
          return `  \\item ${inner}`;
        })
        .join('\n');
      return `\\begin{itemize}\n${items}\n\\end{itemize}\n`;
    }

    case 'orderedList': {
      const items = (node.content ?? [])
        .map((item) => {
          const inner = serializeListItem(item, ctx);
          return `  \\item ${inner}`;
        })
        .join('\n');
      return `\\begin{enumerate}\n${items}\n\\end{enumerate}\n`;
    }

    case 'blockquote': {
      const inner = serializeNodes(node.content ?? [], ctx);
      return `\\begin{quote}\n${inner}\\end{quote}\n`;
    }

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const code = extractText(node);
      if (lang) {
        return `\\begin{lstlisting}[language=${lang}]\n${code}\n\\end{lstlisting}\n`;
      }
      return `\\begin{verbatim}\n${code}\n\\end{verbatim}\n`;
    }

    case 'mathBlock': {
      const latex = (node.attrs?.latex as string) ?? '';
      const label = (node.attrs?.label as string) ?? '';
      if (label) {
        return `\\begin{equation}\\label{${label}}\n${latex}\n\\end{equation}\n`;
      }
      return `\\begin{equation}\n${latex}\n\\end{equation}\n`;
    }

    case 'figure': {
      const src = (node.attrs?.src as string) ?? '';
      const caption = (node.attrs?.caption as string) ?? '';
      const label = (node.attrs?.label as string) ?? '';
      const lines: string[] = [];
      lines.push('\\begin{figure}[htbp]');
      lines.push('  \\centering');
      lines.push(`  \\includegraphics[width=0.8\\textwidth]{${src}}`);
      if (caption) lines.push(`  \\caption{${escapeLatex(caption)}}`);
      if (label) lines.push(`  \\label{${label}}`);
      lines.push('\\end{figure}');
      return lines.join('\n') + '\n';
    }

    case 'table': {
      return serializeTable(node, ctx);
    }

    case 'horizontalRule': {
      return '\\noindent\\rule{\\textwidth}{0.4pt}\n';
    }

    default:
      return '';
  }
}

function serializeListItem(item: JSONContent, ctx: LaTeXContext): string {
  const parts: string[] = [];
  for (const child of item.content ?? []) {
    if (child.type === 'paragraph') {
      parts.push(serializeInline(child.content ?? [], ctx));
    } else {
      parts.push(serializeNode(child, ctx));
    }
  }
  return parts.join('\n');
}

function serializeTable(tableNode: JSONContent, ctx: LaTeXContext): string {
  const rows = tableNode.content ?? [];
  if (rows.length === 0) return '';

  // Determine column count from first row
  const firstRow = rows[0]?.content ?? [];
  const colCount = firstRow.length;
  const colSpec = Array(colCount).fill('l').join(' ');

  const lines: string[] = [];
  lines.push(`\\begin{table}[htbp]`);
  lines.push('  \\centering');
  lines.push(`  \\begin{tabular}{${colSpec}}`);
  lines.push('    \\toprule');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = (row?.content ?? []).map((cell) => {
      const text = serializeInline(
        cell.content?.flatMap((p) => p.content ?? []) ?? [],
        ctx,
      );
      return text;
    });
    lines.push(`    ${cells.join(' & ')} \\\\`);

    if (i === 0) {
      lines.push('    \\midrule');
    }
  }

  lines.push('    \\bottomrule');
  lines.push('  \\end{tabular}');
  lines.push('\\end{table}');
  return lines.join('\n') + '\n';
}

// ── Inline serialization ──

function serializeInline(nodes: JSONContent[], ctx: LaTeXContext): string {
  return nodes.map((n) => serializeInlineNode(n, ctx)).join('');
}

function serializeInlineNode(node: JSONContent, ctx: LaTeXContext): string {
  if (node.type === 'text') {
    let text = escapeLatex(node.text ?? '');
    text = applyLatexMarks(text, node.marks ?? []);
    return text;
  }

  if (node.type === 'citationNode') {
    const paperId = (node.attrs?.paperId as string) ?? '';
    ctx.registerCitation(paperId);
    return `\\cite{${paperId}}`;
  }

  if (node.type === 'mathInline') {
    const latex = (node.attrs?.latex as string) ?? '';
    return `$${latex}$`;
  }

  if (node.type === 'footnote') {
    const content = (node.attrs?.content as string) ?? '';
    return `\\footnote{${escapeLatex(content)}}`;
  }

  if (node.type === 'crossRef') {
    const label = (node.attrs?.label as string) ?? '';
    return `\\ref{${label}}`;
  }

  if (node.type === 'hardBreak') {
    return '\\\\\n';
  }

  return escapeLatex(node.text ?? '');
}

function applyLatexMarks(
  text: string,
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
): string {
  let result = text;

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        result = `\\textbf{${result}}`;
        break;
      case 'italic':
      case 'em':
        result = `\\textit{${result}}`;
        break;
      case 'code':
        result = `\\texttt{${result}}`;
        break;
      case 'strike':
      case 'strikethrough':
        result = `\\sout{${result}}`;
        break;
      case 'subscript':
        result = `\\textsubscript{${result}}`;
        break;
      case 'superscript':
        result = `\\textsuperscript{${result}}`;
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) ?? '';
        result = `\\href{${href}}{${result}}`;
        break;
      }
      case 'highlight':
        result = `\\colorbox{yellow}{${result}}`;
        break;
    }
  }

  return result;
}

// ── Utilities ──

function headingCommand(level: number): string {
  switch (level) {
    case 1: return '\\section';
    case 2: return '\\subsection';
    case 3: return '\\subsubsection';
    case 4: return '\\paragraph';
    case 5: return '\\subparagraph';
    default: return '\\subparagraph';
  }
}

function extractText(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(extractText).join('');
}

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\x00BACKSLASH\x00')
    .replace(/[&%$#_{}]/g, (ch) => `\\${ch}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\x00BACKSLASH\x00/g, '\\textbackslash{}');
}
