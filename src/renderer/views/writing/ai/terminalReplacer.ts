/**
 * terminalReplacer — Terminal replacement for AI streaming blocks
 *
 * When an AI stream completes, this module:
 * 1. Reads the accumulated markdown from the aiStreamingBlock node attrs
 * 2. Converts it to simple HTML for Tiptap schema parsing via generateJSON
 * 3. Stamps all paragraph nodes with a 'mark' attribute (e.g. 'AI-WRITTEN')
 * 4. Replaces the aiStreamingBlock with the parsed nodes in a single transaction
 * 5. Sets tr.setMeta('aiInsert', true) for undo grouping
 */

import type { Editor } from '@tiptap/react';
import { generateJSON } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CITATION_REGEX } from '../shared/citationPattern';

/** Mark type string applied to AI-generated paragraph nodes */
export type ParagraphMark = 'AI-WRITTEN' | 'MANUAL';

/**
 * Replace the aiStreamingBlock at `blockPos` with parsed content.
 *
 * @returns `true` if replacement succeeded, `false` otherwise
 */
export function performTerminalReplacement(
  editor: Editor,
  blockPos: number,
  markType: ParagraphMark,
): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(blockPos);
  if (!node || node.type.name !== 'aiStreamingBlock') return false;

  const markdown = node.attrs.markdown as string | undefined;
  if (!markdown) return false;

  // Convert markdown to simple HTML, then parse via Tiptap's generateJSON
  const html = markdownToSimpleHTML(markdown);
  const json = generateJSON(html, editor.extensionManager.extensions);

  // Reconstruct a ProseMirror doc from the JSON
  const parsedDoc = state.schema.nodeFromJSON(json);

  // Collect block-level children; stamp paragraphs with the AI mark
  const content: PMNode[] = [];
  parsedDoc.content.forEach((child) => {
    if (child.type.name === 'paragraph') {
      const newAttrs: Record<string, unknown> = { ...child.attrs, mark: markType };
      content.push(child.type.create(newAttrs, child.content, child.marks));
    } else {
      content.push(child);
    }
  });

  // Single transaction: delete the streaming block, insert parsed nodes
  const { tr } = state;
  const blockEnd = blockPos + node.nodeSize;
  tr.delete(blockPos, blockEnd);

  let insertPos = blockPos;
  for (const block of content) {
    tr.insert(insertPos, block);
    insertPos += block.nodeSize;
  }

  tr.setMeta('aiInsert', true);
  editor.view.dispatch(tr);

  return true;
}

// ── Internal helpers ──

/**
 * Minimal markdown-to-HTML converter for Tiptap schema parsing.
 *
 * Handles: paragraphs, H1–H6 headings, bold, italic, inline code,
 * blockquotes, unordered/ordered lists, fenced code blocks,
 * links, and citation markers `[@id]`.
 */
function markdownToSimpleHTML(md: string): string {
  const lines = md.split('\n');
  const result: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCodeBlock = false;
  const codeLines: string[] = [];

  function closeList(): void {
    if (inUl) { result.push('</ul>'); inUl = false; }
    if (inOl) { result.push('</ol>'); inOl = false; }
  }

  for (const line of lines) {
    // Fenced code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
        codeLines.length = 0;
        inCodeBlock = false;
      } else {
        closeList();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1]!.length;
      result.push(`<h${level}>${inlineMarks(headingMatch[2]!)}</h${level}>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      closeList();
      result.push(`<blockquote><p>${inlineMarks(line.slice(2))}</p></blockquote>`);
      continue;
    }

    // Unordered list item
    if (/^[-*+]\s/.test(line)) {
      if (inOl) { result.push('</ol>'); inOl = false; }
      if (!inUl) { result.push('<ul>'); inUl = true; }
      result.push(`<li>${inlineMarks(line.replace(/^[-*+]\s/, ''))}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = /^\d+\.\s(.*)$/.exec(line);
    if (olMatch) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (!inOl) { result.push('<ol>'); inOl = true; }
      result.push(`<li>${inlineMarks(olMatch[1]!)}</li>`);
      continue;
    }

    // Non-list line closes any open list
    closeList();

    // Empty line
    if (line.trim() === '') continue;

    // Regular paragraph
    result.push(`<p>${inlineMarks(line)}</p>`);
  }

  closeList();
  if (inCodeBlock) {
    result.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
  }

  return result.join('\n');
}

/** Apply inline markdown marks to a single line of text. */
function inlineMarks(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(
      new RegExp(CITATION_REGEX.source, 'g'),
      '<cite-node data-paper-id="$1">@$1</cite-node>',
    );
}
