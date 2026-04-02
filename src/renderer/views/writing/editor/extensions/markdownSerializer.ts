/**
 * 【Δ-2】Custom Markdown serializer/parser for the Tiptap schema.
 *
 * serializeToMarkdown(doc) — ProseMirror doc -> Markdown string
 *   - CitationNode -> [@paperId]
 *   - Paragraphs with mark attr -> :::paragraph{mark="..."}\n...\n:::
 *   - Standard nodes -> standard Markdown
 *
 * parseFromMarkdown(markdown, schema) — Markdown -> ProseMirror doc
 *   - [@paperId] -> CitationNode
 *   - :::paragraph{mark="..."} -> paragraph with mark attr
 *   - Standard Markdown -> standard nodes
 */

import type { Node as ProseMirrorNode, Schema, Mark } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';

// ═══════════════════════════════════════════════════════════════════════
// Serialization: ProseMirror Document -> Markdown
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a ProseMirror document to Markdown string.
 */
export function serializeToMarkdown(doc: ProseMirrorNode): string {
  const lines: string[] = [];
  serializeFragment(doc, lines);
  return lines.join('\n');
}

function serializeFragment(node: ProseMirrorNode, lines: string[]): void {
  node.forEach((child) => {
    serializeNode(child, lines);
  });
}

function serializeNode(node: ProseMirrorNode, lines: string[]): void {
  switch (node.type.name) {
    case 'paragraph': {
      const mark = (node.attrs.mark as string | null) ?? null;
      const text = serializeInlineContent(node);
      if (mark !== null) {
        lines.push(`:::paragraph{mark="${mark}"}`);
        lines.push(text);
        lines.push(':::');
      } else {
        lines.push(text);
      }
      lines.push('');
      break;
    }

    case 'heading': {
      const level = (node.attrs.level as number) ?? 1;
      const prefix = '#'.repeat(Math.min(level, 6));
      const text = serializeInlineContent(node);
      lines.push(`${prefix} ${text}`);
      lines.push('');
      break;
    }

    case 'bulletList': {
      node.forEach((listItem) => {
        const text = serializeListItemContent(listItem);
        lines.push(`- ${text}`);
      });
      lines.push('');
      break;
    }

    case 'orderedList': {
      let index = (node.attrs.start as number) ?? 1;
      node.forEach((listItem) => {
        const text = serializeListItemContent(listItem);
        lines.push(`${index}. ${text}`);
        index++;
      });
      lines.push('');
      break;
    }

    case 'listItem': {
      // Handled by parent list node
      break;
    }

    case 'blockquote': {
      const innerLines: string[] = [];
      serializeFragment(node, innerLines);
      for (const line of innerLines) {
        lines.push(line ? `> ${line}` : '>');
      }
      break;
    }

    case 'codeBlock': {
      const language = (node.attrs.language as string) ?? '';
      lines.push(`\`\`\`${language}`);
      lines.push(node.textContent);
      lines.push('```');
      lines.push('');
      break;
    }

    case 'horizontalRule': {
      lines.push('---');
      lines.push('');
      break;
    }

    case 'hardBreak': {
      // Append to last line
      const lastIndex = lines.length - 1;
      if (lastIndex >= 0) {
        lines[lastIndex] = (lines[lastIndex] ?? '') + '  ';
      }
      break;
    }

    case 'citationNode': {
      // Inline node, handled by serializeInlineContent
      break;
    }

    case 'mathInline': {
      // Inline node, handled by serializeInlineContent
      break;
    }

    case 'mathBlock': {
      const latex = (node.attrs.latex as string) ?? '';
      lines.push('$$');
      lines.push(latex);
      lines.push('$$');
      lines.push('');
      break;
    }

    case 'aiStreamingBlock': {
      // Runtime-only node — skip during serialization
      break;
    }

    case 'section': {
      // Unified editor section wrapper — serialize children directly
      serializeFragment(node, lines);
      break;
    }

    case 'figure': {
      const src = (node.attrs.src as string) ?? '';
      const alt = (node.attrs.alt as string) ?? '';
      const caption = (node.attrs.caption as string) ?? '';
      const label = (node.attrs.label as string) ?? '';
      lines.push(`![${alt}](${src})`);
      if (caption) {
        lines.push(`*${caption}*`);
      }
      if (label) {
        lines.push(`{#${label}}`);
      }
      lines.push('');
      break;
    }

    case 'table': {
      serializeTable(node, lines);
      lines.push('');
      break;
    }

    default: {
      // Fallback: try to serialize as text content
      const text = node.textContent;
      if (text) {
        lines.push(text);
        lines.push('');
      }
      break;
    }
  }
}

function serializeListItemContent(listItem: ProseMirrorNode): string {
  const parts: string[] = [];
  listItem.forEach((child) => {
    if (child.type.name === 'paragraph') {
      parts.push(serializeInlineContent(child));
    } else {
      parts.push(child.textContent);
    }
  });
  return parts.join('\n  ');
}

function serializeInlineContent(node: ProseMirrorNode): string {
  const parts: string[] = [];

  node.forEach((child) => {
    if (child.type.name === 'citationNode') {
      const paperId = (child.attrs.paperId as string) ?? '';
      parts.push(`[@${paperId}]`);
      return;
    }

    if (child.type.name === 'mathInline') {
      const latex = (child.attrs.latex as string) ?? '';
      parts.push(`$${latex}$`);
      return;
    }

    if (child.type.name === 'footnote') {
      const content = (child.attrs.content as string) ?? '';
      parts.push(`[^${content}]`);
      return;
    }

    if (child.type.name === 'crossRef') {
      const label = (child.attrs.label as string) ?? '';
      const displayText = (child.attrs.displayText as string) ?? '';
      parts.push(displayText || `{@${label}}`);
      return;
    }

    if (child.isText) {
      let text = child.text ?? '';
      text = applyMarks(text, child.marks);
      parts.push(text);
      return;
    }

    if (child.type.name === 'hardBreak') {
      parts.push('  \n');
      return;
    }

    // Fallback for other inline nodes
    parts.push(child.textContent);
  });

  return parts.join('');
}

function applyMarks(text: string, marks: readonly Mark[]): string {
  let result = text;

  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold':
      case 'strong':
        result = `**${result}**`;
        break;
      case 'italic':
      case 'em':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
      case 'strikethrough':
        result = `~~${result}~~`;
        break;
      case 'link': {
        const href = (mark.attrs.href as string) ?? '';
        const title = (mark.attrs.title as string | null) ?? null;
        if (title !== null) {
          result = `[${result}](${href} "${title}")`;
        } else {
          result = `[${result}](${href})`;
        }
        break;
      }
      case 'subscript':
        result = `~${result}~`;
        break;
      case 'superscript':
        result = `^${result}^`;
        break;
      // Other marks: pass through unchanged
    }
  }

  return result;
}

function serializeTable(node: ProseMirrorNode, lines: string[]): void {
  const rows: string[][] = [];
  let headerRowCount = 0;

  node.forEach((row, _offset, index) => {
    const cells: string[] = [];
    let isHeader = false;
    row.forEach((cell) => {
      if (cell.type.name === 'tableHeader') {
        isHeader = true;
      }
      cells.push(cell.textContent);
    });
    rows.push(cells);
    if (isHeader && index === 0) {
      headerRowCount = 1;
    }
  });

  if (rows.length === 0) return;

  // Column widths
  const colCount = rows[0]?.length ?? 0;
  const colWidths: number[] = new Array(colCount).fill(3);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cellLen = (row[i]?.length ?? 0) + 2;
      if (colWidths[i] !== undefined && cellLen > (colWidths[i] ?? 0)) {
        colWidths[i] = cellLen;
      }
    }
  }

  function formatRow(cells: string[]): string {
    const paddedCells = cells.map((cell, i) => {
      const width = colWidths[i] ?? 3;
      return ` ${cell.padEnd(width - 1)} `;
    });
    return `|${paddedCells.join('|')}|`;
  }

  function separatorRow(): string {
    const seps = colWidths.map((w) => '-'.repeat(w + 2));
    return `|${seps.join('|')}|`;
  }

  const firstRow = rows[0];
  if (firstRow) {
    lines.push(formatRow(firstRow));
  }
  lines.push(separatorRow());
  for (let i = headerRowCount > 0 ? 1 : 0; i < rows.length; i++) {
    const row = rows[i];
    if (row) {
      lines.push(formatRow(row));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Parsing: Markdown -> ProseMirror Document
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert Markdown string to a ProseMirror document node.
 *
 * Strategy:
 * 1. Pre-process custom directives (:::paragraph{mark="..."})
 * 2. Pre-process citation references ([@paperId])
 * 3. Parse as JSONContent and build ProseMirror doc
 */
export function parseFromMarkdown(markdown: string, schema: Schema): ProseMirrorNode {
  const jsonContent = markdownToJSONContent(markdown);
  return nodeFromJSON(jsonContent, schema);
}

/**
 * Convert Markdown to Tiptap JSONContent structure.
 * This is a line-by-line parser for the subset of Markdown we support.
 */
function markdownToJSONContent(markdown: string): JSONContent {
  const lines = markdown.split('\n');
  const content: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // :::paragraph{mark="..."} directive
    const directiveMatch = /^:::paragraph\{mark="([^"]+)"\}$/.exec(line);
    if (directiveMatch) {
      const mark = directiveMatch[1] ?? null;
      const paragraphLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() !== ':::') {
        paragraphLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++; // skip closing :::
      const text = paragraphLines.join('\n');
      content.push({
        type: 'paragraph',
        attrs: { mark },
        content: parseInlineContent(text),
      });
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const text = headingMatch[2] ?? '';
      content.push({
        type: 'heading',
        attrs: { level },
        content: parseInlineContent(text),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Code block
    const codeBlockMatch = /^```(.*)$/.exec(line);
    if (codeBlockMatch) {
      const language = codeBlockMatch[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() !== '```') {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      content.push({
        type: 'codeBlock',
        attrs: { language },
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    // Math block ($$)
    if (line.trim() === '$$') {
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() !== '$$') {
        mathLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++; // skip closing $$
      content.push({
        type: 'mathBlock',
        attrs: { latex: mathLines.join('\n') },
      });
      continue;
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const qLine = lines[i] ?? '';
        if (qLine.startsWith('> ')) {
          quoteLines.push(qLine.slice(2));
        } else if (qLine === '>') {
          quoteLines.push('');
        } else {
          break;
        }
        i++;
      }
      const innerContent = markdownToJSONContent(quoteLines.join('\n'));
      content.push({
        type: 'blockquote',
        content: innerContent.content ?? [],
      });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const listItems: JSONContent[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^[-*+]\s/, '');
        listItems.push({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: parseInlineContent(itemText),
            },
          ],
        });
        i++;
      }
      content.push({
        type: 'bulletList',
        content: listItems,
      });
      continue;
    }

    // Ordered list
    const orderedMatch = /^(\d+)\.\s/.exec(line);
    if (orderedMatch) {
      const start = parseInt(orderedMatch[1] ?? '1', 10);
      const listItems: JSONContent[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^\d+\.\s/, '');
        listItems.push({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: parseInlineContent(itemText),
            },
          ],
        });
        i++;
      }
      content.push({
        type: 'orderedList',
        attrs: { start },
        content: listItems,
      });
      continue;
    }

    // Regular paragraph
    const paragraphLines: string[] = [line];
    i++;
    // Consume continuation lines (non-empty, non-special)
    while (i < lines.length) {
      const nextLine = lines[i] ?? '';
      if (
        nextLine.trim() === '' ||
        /^#{1,6}\s/.test(nextLine) ||
        /^[-*+]\s/.test(nextLine) ||
        /^\d+\.\s/.test(nextLine) ||
        nextLine.startsWith('> ') ||
        nextLine.startsWith('```') ||
        nextLine.trim() === '$$' ||
        nextLine.startsWith(':::') ||
        /^---+$/.test(nextLine)
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      i++;
    }

    content.push({
      type: 'paragraph',
      content: parseInlineContent(paragraphLines.join(' ')),
    });
  }

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
}

/**
 * Parse inline Markdown content (bold, italic, code, citations, math, links).
 * Returns an array of JSONContent nodes (text with marks + inline nodes).
 */
function parseInlineContent(text: string): JSONContent[] {
  if (!text) return [];

  const nodes: JSONContent[] = [];

  // Tokenize inline content using regex
  // Order matters: longer/more specific patterns first
  const inlinePattern =
    /(\[@([a-zA-Z0-9_-]+)\])|(\$([^$\n]+)\$)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\))|(~~(.+?)~~)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      const plainText = text.slice(lastIndex, match.index);
      if (plainText) {
        nodes.push({ type: 'text', text: plainText });
      }
    }

    if (match[1] !== undefined) {
      // Citation: [@paperId]
      const paperId = match[2] ?? '';
      nodes.push({
        type: 'citationNode',
        attrs: { paperId, displayText: `@${paperId}` },
      });
    } else if (match[3] !== undefined) {
      // Math inline: $...$
      const latex = match[4] ?? '';
      nodes.push({
        type: 'mathInline',
        attrs: { latex },
      });
    } else if (match[5] !== undefined) {
      // Bold: **...**
      const boldText = match[6] ?? '';
      nodes.push({
        type: 'text',
        text: boldText,
        marks: [{ type: 'bold' }],
      });
    } else if (match[7] !== undefined) {
      // Italic: *...*
      const italicText = match[8] ?? '';
      nodes.push({
        type: 'text',
        text: italicText,
        marks: [{ type: 'italic' }],
      });
    } else if (match[9] !== undefined) {
      // Code: `...`
      const codeText = match[10] ?? '';
      nodes.push({
        type: 'text',
        text: codeText,
        marks: [{ type: 'code' }],
      });
    } else if (match[11] !== undefined) {
      // Link: [text](url) or [text](url "title")
      const linkText = match[12] ?? '';
      const href = match[13] ?? '';
      const title = match[14] ?? null;
      const linkAttrs: Record<string, unknown> = { href };
      if (title !== null) {
        linkAttrs.title = title;
      }
      nodes.push({
        type: 'text',
        text: linkText,
        marks: [{ type: 'link', attrs: linkAttrs }],
      });
    } else if (match[15] !== undefined) {
      // Strikethrough: ~~...~~
      const strikeText = match[16] ?? '';
      nodes.push({
        type: 'text',
        text: strikeText,
        marks: [{ type: 'strike' }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      nodes.push({ type: 'text', text: remaining });
    }
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}

/**
 * Convert JSONContent to a ProseMirror Node using the provided schema.
 */
function nodeFromJSON(json: JSONContent, schema: Schema): ProseMirrorNode {
  // Recursively build the ProseMirror node tree
  const nodeType = schema.nodes[json.type ?? 'doc'];
  if (!nodeType) {
    // Fallback to paragraph if type not found
    const paragraphType = schema.nodes.paragraph;
    if (!paragraphType) {
      throw new Error('Schema must have a paragraph node type');
    }
    return paragraphType.create(null, schema.text(json.text ?? ''));
  }

  // Text nodes must be created through schema.text, not NodeType.create.
  if (json.type === 'text') {
    const text = json.text ?? '';
    const marks = (json.marks ?? []).map((markJson) => {
      const markSpec = markJson as { type: string; attrs?: Record<string, unknown> | undefined };
      const markType = schema.marks[markSpec.type];
      if (!markType) return null;
      return markType.create(markSpec.attrs ?? null);
    }).filter((m): m is Mark => m !== null);

    return schema.text(text, marks.length > 0 ? marks : undefined);
  }

  // Atom nodes / leaf nodes without content
  if (nodeType.isAtom || (nodeType.isLeaf && !json.content)) {
    return nodeType.create(json.attrs ?? null);
  }

  // Container nodes with children
  const children = (json.content ?? []).map((child) => nodeFromJSON(child, schema));
  const validChildren = children.filter((child): child is ProseMirrorNode => child !== null);

  try {
    return nodeType.create(json.attrs ?? null, validChildren.length > 0 ? validChildren : undefined);
  } catch {
    // If creation fails (e.g. invalid content), return empty node
    return nodeType.create(json.attrs ?? null);
  }
}
