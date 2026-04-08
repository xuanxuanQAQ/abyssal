/**
 * Block-Text Fusion Module
 *
 * Merges DLA ContentBlock[] with character-level position data to produce
 * TypedBlock[] with correct reading order and multi-column support.
 *
 * This is Layer 0 of the unified pipeline — consumed by:
 *   - Processing pipeline (section detection, chunking, reference extraction)
 *   - Analysis pipeline (block-type-aware RAG retrieval)
 *   - Reader pipeline (cached DLA results from DB)
 */

import type {
  ContentBlock,
  TypedBlock,
  PageCharData,
  CharWithPosition,
  NormalizedBBox,
  DocumentStructure,
  DocumentSection,
  ContentBlockType,
} from './types';
import type { SectionLabel } from '../types/chunk';
import type { Logger } from '../infra/logger';

// ─── Constants ───

/** Blocks whose text should be excluded from fullText chunks */
const EXCLUDE_FROM_TEXT: Set<ContentBlockType> = new Set([
  'figure', 'table', 'formula', 'abandoned',
]);

/** Block types that are non-textual content */
const NON_TEXT_BLOCKS: Set<ContentBlockType> = new Set([
  'figure', 'table', 'formula',
]);

/** Caption block types */
const CAPTION_TYPES: Set<ContentBlockType> = new Set([
  'figure_caption', 'table_caption', 'table_footnote', 'formula_caption',
]);

// ─── §1 Block-Text Fusion ───

/**
 * Assign extracted characters to their containing DLA blocks via bbox containment.
 *
 * For each page:
 *   1. Test each character against all blocks on that page
 *   2. Assign character to the smallest containing block (most specific)
 *   3. Unassigned characters are collected into a fallback 'text' block
 *
 * Returns TypedBlock[] WITHOUT reading order (call resolveReadingOrder next).
 */
export function fuseBlocksAndChars(
  blocks: ContentBlock[],
  pageCharData: PageCharData[],
): TypedBlock[] {
  const result: TypedBlock[] = [];
  const charDataByPage = new Map<number, PageCharData>();
  for (const pcd of pageCharData) {
    charDataByPage.set(pcd.pageIndex, pcd);
  }

  // Group blocks by page
  const blocksByPage = new Map<number, ContentBlock[]>();
  for (const block of blocks) {
    const arr = blocksByPage.get(block.pageIndex) ?? [];
    arr.push(block);
    blocksByPage.set(block.pageIndex, arr);
  }

  // Process each page
  const allPages = new Set([...blocksByPage.keys(), ...charDataByPage.keys()]);

  for (const pageIndex of allPages) {
    const pageBlocks = blocksByPage.get(pageIndex) ?? [];
    const pcd = charDataByPage.get(pageIndex);

    if (!pcd || pcd.chars.length === 0) {
      // No char data → create blocks with null text
      for (const block of pageBlocks) {
        result.push({
          blockType: block.type,
          bbox: block.bbox,
          confidence: block.confidence,
          pageIndex: block.pageIndex,
          text: null,
          readingOrder: 0,
          columnIndex: -1,
          charStart: null,
          charEnd: null,
        });
      }
      continue;
    }

    // Sort blocks by area (smallest first) for most-specific containment
    const sortedBlocks = [...pageBlocks].sort(
      (a, b) => bboxArea(a.bbox) - bboxArea(b.bbox),
    );

    // Assign chars to blocks
    const blockChars = new Map<number, CharWithPosition[]>();
    for (let bi = 0; bi < sortedBlocks.length; bi++) {
      blockChars.set(bi, []);
    }
    const unassigned: CharWithPosition[] = [];

    for (const ch of pcd.chars) {
      let assigned = false;
      for (let bi = 0; bi < sortedBlocks.length; bi++) {
        if (bboxContains(sortedBlocks[bi]!.bbox, ch.x, ch.y)) {
          blockChars.get(bi)!.push(ch);
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        unassigned.push(ch);
      }
    }

    // Build TypedBlocks from assigned chars
    for (let bi = 0; bi < sortedBlocks.length; bi++) {
      const block = sortedBlocks[bi]!;
      const chars = blockChars.get(bi)!;
      const text = chars.length > 0 ? chars.map(c => c.char).join('') : null;

      result.push({
        blockType: block.type,
        bbox: block.bbox,
        confidence: block.confidence,
        pageIndex: block.pageIndex,
        text,
        readingOrder: 0,
        columnIndex: -1,
        charStart: null,
        charEnd: null,
      });
    }

    // Unassigned chars → fallback text block (if any significant text)
    if (unassigned.length > 5) {
      const text = unassigned.map(c => c.char).join('');
      if (text.trim().length > 0) {
        const minX = Math.min(...unassigned.map(c => c.x));
        const minY = Math.min(...unassigned.map(c => c.y));
        const maxX = Math.max(...unassigned.map(c => c.x));
        const maxY = Math.max(...unassigned.map(c => c.y));
        result.push({
          blockType: 'text',
          bbox: { x: minX, y: minY, w: maxX - minX + 0.01, h: maxY - minY + 0.01 },
          confidence: 0.5,
          pageIndex,
          text,
          readingOrder: 0,
          columnIndex: -1,
          charStart: null,
          charEnd: null,
        });
      }
    }
  }

  return result;
}

// ─── §2 Column Detection + Reading Order ───

/**
 * Detect multi-column layout and assign reading order to all blocks.
 *
 * Strategy:
 *   - For each page, cluster text block center-x positions
 *   - If bimodal distribution detected → double column
 *   - Spanning blocks (title, wide figure) → column = -1
 *   - Left column first (top→bottom), then right column (top→bottom)
 */
export function resolveReadingOrder(blocks: TypedBlock[]): {
  blocks: TypedBlock[];
  columnLayout: 'single' | 'double' | 'mixed';
} {
  if (blocks.length === 0) {
    return { blocks, columnLayout: 'single' };
  }

  // Group by page
  const byPage = new Map<number, TypedBlock[]>();
  for (const b of blocks) {
    const arr = byPage.get(b.pageIndex) ?? [];
    arr.push(b);
    byPage.set(b.pageIndex, arr);
  }

  let globalOrder = 0;
  let doubleColPages = 0;
  let singleColPages = 0;

  // Process pages in order
  const pageIndices = [...byPage.keys()].sort((a, b) => a - b);

  for (const pageIndex of pageIndices) {
    const pageBlocks = byPage.get(pageIndex)!;

    // Get text blocks for column detection (exclude titles which may span)
    const textBlocks = pageBlocks.filter(
      b => b.blockType === 'text' && b.bbox.w < 0.7,
    );

    const isDoubleCol = detectDoubleColumn(textBlocks);

    if (isDoubleCol) {
      doubleColPages++;
      const midX = 0.5;
      const threshold = 0.15; // blocks within 15% of center are "spanning"

      for (const b of pageBlocks) {
        const cx = b.bbox.x + b.bbox.w / 2;
        if (b.bbox.w > 0.6 || (cx > midX - threshold && cx < midX + threshold && b.blockType === 'title')) {
          b.columnIndex = -1; // spanning
        } else if (cx < midX) {
          b.columnIndex = 0; // left
        } else {
          b.columnIndex = 1; // right
        }
      }

      // Sort: spanning by y, then left column by y, then right column by y
      const spanning = pageBlocks.filter(b => b.columnIndex === -1);
      const left = pageBlocks.filter(b => b.columnIndex === 0);
      const right = pageBlocks.filter(b => b.columnIndex === 1);

      spanning.sort((a, b) => a.bbox.y - b.bbox.y);
      left.sort((a, b) => a.bbox.y - b.bbox.y);
      right.sort((a, b) => a.bbox.y - b.bbox.y);

      // Merge: interleave spanning blocks at their y position
      const ordered = mergeWithSpanning(left, right, spanning);
      for (const b of ordered) {
        b.readingOrder = globalOrder++;
      }
    } else {
      singleColPages++;
      // Single column: sort by y, then x
      pageBlocks.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
      for (const b of pageBlocks) {
        b.columnIndex = -1;
        b.readingOrder = globalOrder++;
      }
    }
  }

  const columnLayout: 'single' | 'double' | 'mixed' =
    doubleColPages === 0 ? 'single' :
    singleColPages === 0 ? 'double' : 'mixed';

  // Re-sort by reading order
  blocks.sort((a, b) => a.readingOrder - b.readingOrder);

  return { blocks, columnLayout };
}

/**
 * Detect bimodal distribution of text block center-x positions.
 * If blocks cluster into two groups with gap > 10%, it's double column.
 */
function detectDoubleColumn(textBlocks: TypedBlock[]): boolean {
  if (textBlocks.length < 4) return false;

  const centers = textBlocks.map(b => b.bbox.x + b.bbox.w / 2).sort((a, b) => a - b);

  // Find the largest gap between consecutive centers
  let maxGap = 0;
  let gapPos = 0;
  for (let i = 1; i < centers.length; i++) {
    const gap = centers[i]! - centers[i - 1]!;
    if (gap > maxGap) {
      maxGap = gap;
      gapPos = i;
    }
  }

  if (maxGap < 0.1) return false;

  // Check that both clusters have at least 2 blocks
  const leftCount = gapPos;
  const rightCount = centers.length - gapPos;
  return leftCount >= 2 && rightCount >= 2;
}

/**
 * Merge left/right column blocks with spanning blocks interleaved by y position.
 */
function mergeWithSpanning(
  left: TypedBlock[],
  right: TypedBlock[],
  spanning: TypedBlock[],
): TypedBlock[] {
  const result: TypedBlock[] = [];
  let si = 0;

  // Read left column first, then right, but insert spanning blocks
  // at their correct vertical positions
  const columnar = [...left, ...right]; // left first, then right
  columnar.sort((a, b) => {
    // Left column entirely before right column at same y
    if (a.columnIndex !== b.columnIndex) return a.columnIndex - b.columnIndex;
    return a.bbox.y - b.bbox.y;
  });

  let ci = 0;
  while (ci < columnar.length || si < spanning.length) {
    if (si < spanning.length) {
      const spanY = spanning[si]!.bbox.y;
      // Insert all spanning blocks that come before current columnar block
      if (ci >= columnar.length || spanY < columnar[ci]!.bbox.y) {
        result.push(spanning[si]!);
        si++;
        continue;
      }
    }
    if (ci < columnar.length) {
      result.push(columnar[ci]!);
      ci++;
    }
  }

  return result;
}

// ─── §3 Character Offset Assignment ───

/**
 * Assign charStart/charEnd offsets to TypedBlocks based on their text content
 * matching against the fullText string.
 *
 * Uses a forward-scanning approach: since blocks are in reading order,
 * text assignments should be monotonically increasing in fullText position.
 */
export function assignCharOffsets(
  blocks: TypedBlock[],
  fullText: string,
): void {
  let searchFrom = 0;

  for (const block of blocks) {
    if (!block.text || block.text.trim().length === 0) continue;

    // Take a representative snippet (first 50 chars) for matching
    const snippet = block.text.trim().slice(0, 50);
    if (snippet.length < 3) continue;

    const idx = fullText.indexOf(snippet, searchFrom);
    if (idx !== -1) {
      block.charStart = idx;
      // Find where block text ends
      const endSnippet = block.text.trim().slice(-30);
      const endIdx = fullText.indexOf(endSnippet, idx);
      block.charEnd = endIdx !== -1 ? endIdx + endSnippet.length : idx + block.text.length;
      // Advance searchFrom past current block to ensure monotonic progress
      searchFrom = block.charEnd;
    }
  }
}

// ─── §4 Document Structure Tree ───

/** Section title keyword → SectionLabel mapping */
const SECTION_KEYWORD_MAP: Array<[RegExp, SectionLabel]> = [
  [/^abstract$/i, 'abstract'],
  [/introduc/i, 'introduction'],
  [/background/i, 'background'],
  [/literature\s+review|related\s+work|prior\s+art/i, 'literature_review'],
  [/method|approach|experiment(?:al)?\s+(?:setup|design)|implementation/i, 'method'],
  [/result|finding|evaluation|empirical/i, 'results'],
  [/discuss/i, 'discussion'],
  [/conclu|summary|future\s+work/i, 'conclusion'],
  [/appendix|appendices|supplementary|附录/i, 'appendix'],
  [/参考文献|references?|bibliography|works?\s+cited/i, 'unknown'], // handled specially
];

const REFERENCE_RE = /references?|bibliography|参考文献|works?\s+cited/i;

/** Detect heading depth from numbering: "3" → 1, "3.1" → 2, "3.1.2" → 3, "IV" → 1 */
const NUMBERED_PREFIX_RE = /^(\d+(?:\.\d+)*|[IVXLC]+)[.\s)\-:]\s*/i;

function detectHeadingDepth(text: string): number {
  const m = NUMBERED_PREFIX_RE.exec(text.trim());
  if (m && m[1]) {
    const num = m[1];
    // Roman numerals → depth 1
    if (/^[IVXLC]+$/i.test(num)) return 1;
    return num.split('.').length;
  }
  return 1;
}

function classifySectionTitle(text: string): SectionLabel {
  const trimmed = text.trim();
  // Strip leading section numbers
  const cleaned = trimmed.replace(/^(?:\d+(?:\.\d+)*|[IVXLC]+)[.\s)\-:]\s*/i, '');
  for (const [re, label] of SECTION_KEYWORD_MAP) {
    if (re.test(cleaned)) return label;
  }
  return 'unknown';
}

/**
 * Build document structure tree from TypedBlocks in reading order.
 *
 * Identifies sections by title blocks, associates body text/figures/tables,
 * and detects the reference section.
 */
export function buildDocumentStructure(blocks: TypedBlock[]): DocumentStructure {
  const sections: DocumentSection[] = [];
  let current: DocumentSection | null = null;
  let referenceSection: DocumentStructure['referenceSection'] = null;
  let inReferences = false;
  const refEntries: TypedBlock[] = [];

  // Stack for nested section tracking: top of stack is the current parent
  const sectionStack: DocumentSection[] = [];

  for (const block of blocks) {
    if (block.blockType === 'title') {
      const label = classifySectionTitle(block.text ?? '');
      const depth = detectHeadingDepth(block.text ?? '');

      // Check if this is the references section
      if (REFERENCE_RE.test(block.text ?? '')) {
        inReferences = true;
        referenceSection = { titleBlock: block, entries: refEntries };
        current = null;
        sectionStack.length = 0;
        continue;
      }

      inReferences = false;

      const newSection: DocumentSection = {
        titleBlock: block,
        label,
        depth,
        bodyBlocks: [],
        figures: [],
        tables: [],
        formulas: [],
        children: [],
      };

      // Pop stack until we find a parent with smaller depth
      while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1]!.depth >= depth) {
        sectionStack.pop();
      }

      if (sectionStack.length > 0 && depth > 1) {
        // Nest as child of parent section
        sectionStack[sectionStack.length - 1]!.children.push(newSection);
      } else {
        // Top-level section
        sections.push(newSection);
      }

      sectionStack.push(newSection);
      current = newSection;
      continue;
    }

    if (inReferences && block.blockType === 'text') {
      refEntries.push(block);
      continue;
    }

    if (!current) {
      // Blocks before the first title → create implicit 'unknown' section
      current = {
        titleBlock: block,
        label: 'unknown',
        depth: 0,
        bodyBlocks: [],
        figures: [],
        tables: [],
        formulas: [],
        children: [],
      };
      sections.push(current);
    }

    if (block.blockType === 'text') {
      current.bodyBlocks.push(block);
    } else if (block.blockType === 'figure' || block.blockType === 'figure_caption') {
      current.figures.push(block);
    } else if (block.blockType === 'table' || block.blockType === 'table_caption' || block.blockType === 'table_footnote') {
      current.tables.push(block);
    } else if (block.blockType === 'formula' || block.blockType === 'formula_caption') {
      current.formulas.push(block);
    }
    // 'abandoned' blocks are silently skipped
  }

  // Detect column layout
  let doubleCount = 0;
  let singleCount = 0;
  for (const b of blocks) {
    if (b.columnIndex === 0 || b.columnIndex === 1) doubleCount++;
    else singleCount++;
  }
  const columnLayout: DocumentStructure['columnLayout'] =
    doubleCount === 0 ? 'single' :
    singleCount <= blocks.length * 0.2 ? 'double' : 'mixed';

  return {
    sections,
    referenceSection,
    readingOrder: blocks,
    columnLayout,
  };
}

// ─── §5 Full Fusion Pipeline ───

/**
 * Complete fusion pipeline: ContentBlock[] + PageCharData[] → DocumentStructure.
 *
 * Steps:
 *   1. Fuse blocks with character positions
 *   2. Detect columns and assign reading order
 *   3. Assign character offsets in fullText
 *   4. Build document structure tree
 */
export function runFusionPipeline(
  dlaBlocks: ContentBlock[],
  pageCharData: PageCharData[],
  fullText: string,
  logger?: Logger | null,
): { structure: DocumentStructure; typedBlocks: TypedBlock[]; columnLayout: string } {
  const t0 = Date.now();

  // Step 1: Fuse
  const fused = fuseBlocksAndChars(dlaBlocks, pageCharData);
  const t1 = Date.now();
  const pagesWithChars = pageCharData.filter(p => p.chars.length > 0).length;
  const blocksWithText = fused.filter(b => b.text && b.text.trim().length > 0).length;
  logger?.info('[Fusion] Step 1: block-char fusion', {
    inputBlocks: dlaBlocks.length,
    pages: pageCharData.length,
    pagesWithChars,
    fusedBlocks: fused.length,
    blocksWithText,
    durationMs: t1 - t0,
  });

  // Step 2: Reading order
  const { blocks: ordered, columnLayout } = resolveReadingOrder(fused);
  const t2 = Date.now();
  logger?.info('[Fusion] Step 2: reading order + column detection', {
    columnLayout,
    durationMs: t2 - t1,
  });

  // Step 3: Character offsets
  assignCharOffsets(ordered, fullText);
  const t3 = Date.now();
  const assignedCount = ordered.filter(b => b.charStart != null).length;
  logger?.info('[Fusion] Step 3: char offset assignment', {
    assigned: assignedCount,
    total: ordered.length,
    fullTextLen: fullText.length,
    durationMs: t3 - t2,
  });

  // Step 4: Document structure
  const structure = buildDocumentStructure(ordered);
  const t4 = Date.now();
  logger?.info('[Fusion] Step 4: document structure', {
    sections: structure.sections.length,
    hasRefSection: structure.referenceSection != null,
    refEntries: structure.referenceSection?.entries.length ?? 0,
    columnLayout: structure.columnLayout,
    totalDurationMs: t4 - t0,
  });

  return { structure, typedBlocks: ordered, columnLayout };
}

// ─── §6 Helpers ───

/** Check if a point (x, y) falls within a bbox */
function bboxContains(bbox: NormalizedBBox, x: number, y: number): boolean {
  return (
    x >= bbox.x &&
    x <= bbox.x + bbox.w &&
    y >= bbox.y &&
    y <= bbox.y + bbox.h
  );
}

/** Compute bbox area */
function bboxArea(bbox: NormalizedBBox): number {
  return bbox.w * bbox.h;
}

/**
 * Check whether a block type should be excluded from main text extraction.
 */
export function isExcludedBlock(type: ContentBlockType): boolean {
  return EXCLUDE_FROM_TEXT.has(type);
}

/**
 * Check whether a block type represents non-textual content.
 */
export function isNonTextBlock(type: ContentBlockType): boolean {
  return NON_TEXT_BLOCKS.has(type);
}

/**
 * Check whether a block type is a caption.
 */
export function isCaptionBlock(type: ContentBlockType): boolean {
  return CAPTION_TYPES.has(type);
}
