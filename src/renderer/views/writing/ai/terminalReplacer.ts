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
 * Handles: paragraphs, H2/H3 headings, bold, italic, inline code,
 * blockquotes, unordered lists, and citation markers `[@id]`.
 */
function markdownToSimpleHTML(md: string): string {
  let html = md
    // Headings (must come before paragraph wrapping)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
    // List items
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Inline marks
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Citation markers → cite-node custom element
    .replace(
      new RegExp(CITATION_REGEX.source, 'g'),
      '<cite-node data-paper-id="$1">@$1</cite-node>',
    );

  // Wrap remaining plain-text lines in <p> tags and group <li> runs into <ul>
  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('<li>')) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      result.push(line);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (
        line.startsWith('<h') ||
        line.startsWith('<blockquote>') ||
        line.trim() === ''
      ) {
        result.push(line);
      } else if (line.trim()) {
        result.push(`<p>${line}</p>`);
      }
    }
  }
  if (inList) result.push('</ul>');

  return result.join('\n');
}
