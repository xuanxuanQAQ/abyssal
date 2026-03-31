/**
 * documentAssembler — Assembles/disassembles unified ProseMirror documents.
 *
 * Load: Fetches all section contents → assembles into doc > section+ JSON
 * Save: Diffs current doc against known state → saves only changed sections
 *
 * Uses sectionId attributes on section nodes to map back to outline entries.
 */

import type { JSONContent } from '@tiptap/core';
import type { FullDocumentSection } from '../../../../shared-types/models';

/**
 * Assemble a full ProseMirror document from section data.
 * Each section becomes a `section` node containing a heading + body content.
 */
export function assembleDocument(
  sections: FullDocumentSection[],
): JSONContent {
  if (sections.length === 0) {
    return {
      type: 'doc',
      content: [
        {
          type: 'section',
          attrs: { sectionId: '', level: 1 },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
  }

  // Build tree structure from flat sections
  const rootSections = buildHierarchy(sections);
  const docContent = flattenToSectionNodes(rootSections, 1);

  return {
    type: 'doc',
    content: docContent.length > 0 ? docContent : [{ type: 'paragraph' }],
  };
}

interface HierarchicalSection extends FullDocumentSection {
  children: HierarchicalSection[];
}

function buildHierarchy(sections: FullDocumentSection[]): HierarchicalSection[] {
  const map = new Map<string, HierarchicalSection>();
  const roots: HierarchicalSection[] = [];

  // Create all nodes
  for (const s of sections) {
    map.set(s.sectionId, { ...s, children: [] });
  }

  // Wire parent-child
  for (const s of sections) {
    const node = map.get(s.sectionId)!;
    if (s.parentId && map.has(s.parentId)) {
      map.get(s.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort by sortIndex at each level
  function sortRecursive(nodes: HierarchicalSection[]): void {
    nodes.sort((a, b) => a.sortIndex - b.sortIndex);
    for (const n of nodes) sortRecursive(n.children);
  }
  sortRecursive(roots);

  return roots;
}

function flattenToSectionNodes(
  sections: HierarchicalSection[],
  level: number,
): JSONContent[] {
  const result: JSONContent[] = [];

  for (const section of sections) {
    const sectionContent: JSONContent[] = [];

    // Add section heading
    sectionContent.push({
      type: 'heading',
      attrs: { level: Math.min(level + 1, 6) },
      content: section.title
        ? [{ type: 'text', text: section.title }]
        : [{ type: 'text', text: '未命名节' }],
    });

    // Parse section body content
    if (section.documentJson) {
      try {
        const parsed = JSON.parse(section.documentJson) as JSONContent;
        if (parsed.content) {
          sectionContent.push(...parsed.content);
        }
      } catch {
        // Fallback: treat as plain text
        if (section.content) {
          sectionContent.push({
            type: 'paragraph',
            content: [{ type: 'text', text: section.content }],
          });
        }
      }
    } else if (section.content) {
      // Content is HTML or Markdown — wrap in paragraph
      // The TiptapEditor will handle parsing via its schema
      sectionContent.push({
        type: 'paragraph',
        content: [{ type: 'text', text: section.content }],
      });
    }

    // If no content at all, add an empty paragraph
    if (sectionContent.length === 1) {
      sectionContent.push({ type: 'paragraph' });
    }

    result.push({
      type: 'section',
      attrs: { sectionId: section.sectionId, level },
      content: sectionContent,
    });

    // Recursively add children at deeper level
    if (section.children.length > 0) {
      result.push(...flattenToSectionNodes(section.children, level + 1));
    }
  }

  return result;
}

/**
 * Extract section contents from a ProseMirror document for saving.
 * Returns a map of sectionId → { content nodes, title }.
 */
export function disassembleDocument(
  docJson: JSONContent,
): Map<string, { title: string; contentNodes: JSONContent[]; documentJson: string }> {
  const result = new Map<string, { title: string; contentNodes: JSONContent[]; documentJson: string }>();

  if (!docJson.content) return result;

  for (const node of docJson.content) {
    if (node.type !== 'section') continue;

    const sectionId = (node.attrs?.sectionId as string) ?? '';
    if (!sectionId) continue;

    const content = node.content ?? [];
    let title = '';
    const bodyNodes: JSONContent[] = [];

    for (const child of content) {
      if (child.type === 'heading' && bodyNodes.length === 0 && !title) {
        // First heading is the section title
        title = extractTextContent(child);
      } else {
        bodyNodes.push(child);
      }
    }

    // Store body content as JSON (without the heading)
    const bodyDoc: JSONContent = {
      type: 'doc',
      content: bodyNodes.length > 0 ? bodyNodes : [{ type: 'paragraph' }],
    };

    result.set(sectionId, {
      title,
      contentNodes: bodyNodes,
      documentJson: JSON.stringify(bodyDoc),
    });
  }

  return result;
}

function extractTextContent(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(extractTextContent).join('');
}

/**
 * Compute a simple content hash for change detection.
 */
export function contentHash(json: JSONContent): string {
  const str = JSON.stringify(json);
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
