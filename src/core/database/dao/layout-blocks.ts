// ═══ Layout Blocks + Section Boundaries DAO ═══
//
// Persists DLA ContentBlock results and section boundaries for reuse
// across processing, analysis, and reader pipelines.

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import type { ContentBlockType, NormalizedBBox } from '../../dla/types';
import type { SectionLabel } from '../../types/chunk';

// ─── Types ───

export interface LayoutBlockRow {
  paperId: PaperId;
  pageIndex: number;
  blockType: ContentBlockType;
  bbox: NormalizedBBox;
  confidence: number;
  readingOrder: number;
  columnIndex: number;
  textContent: string | null;
  charStart: number | null;
  charEnd: number | null;
  modelVersion: string;
}

export interface SectionBoundaryRow {
  paperId: PaperId;
  label: SectionLabel;
  title: string;
  depth: number;
  charStart: number;
  charEnd: number;
  pageStart: number;
  pageEnd: number;
}

// ─── Layout Blocks CRUD ───

export function insertLayoutBlocks(
  db: Database.Database,
  blocks: LayoutBlockRow[],
): void {
  if (blocks.length === 0) return;

  const paperIds = Array.from(new Set(blocks.map((block) => block.paperId)));
  const deleteStmt = db.prepare('DELETE FROM layout_blocks WHERE paper_id = ?');

  const stmt = db.prepare(`
    INSERT INTO layout_blocks
      (paper_id, page_index, block_type, bbox_x, bbox_y, bbox_w, bbox_h,
       confidence, reading_order, column_index, text_content,
       char_start, char_end, model_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchInsert = db.transaction((rows: LayoutBlockRow[]) => {
    for (const paperId of paperIds) {
      deleteStmt.run(paperId);
    }

    for (const b of rows) {
      stmt.run(
        b.paperId, b.pageIndex, b.blockType,
        b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h,
        b.confidence, b.readingOrder, b.columnIndex,
        b.textContent, b.charStart, b.charEnd, b.modelVersion,
      );
    }
  });

  batchInsert(blocks);
}

export function getLayoutBlocks(
  db: Database.Database,
  paperId: PaperId,
): LayoutBlockRow[] {
  const rows = db
    .prepare(`
      SELECT paper_id, page_index, block_type,
             bbox_x, bbox_y, bbox_w, bbox_h,
             confidence, reading_order, column_index,
             text_content, char_start, char_end, model_version
      FROM layout_blocks
      WHERE paper_id = ?
      ORDER BY reading_order ASC
    `)
    .all(paperId) as Array<Record<string, unknown>>;

  return rows.map(mapLayoutBlockRow);
}

export function getLayoutBlocksByPage(
  db: Database.Database,
  paperId: PaperId,
  pageIndex: number,
): LayoutBlockRow[] {
  const rows = db
    .prepare(`
      SELECT paper_id, page_index, block_type,
             bbox_x, bbox_y, bbox_w, bbox_h,
             confidence, reading_order, column_index,
             text_content, char_start, char_end, model_version
      FROM layout_blocks
      WHERE paper_id = ? AND page_index = ?
      ORDER BY reading_order ASC
    `)
    .all(paperId, pageIndex) as Array<Record<string, unknown>>;

  return rows.map(mapLayoutBlockRow);
}

export function getLayoutModelVersion(
  db: Database.Database,
  paperId: PaperId,
): string | null {
  const row = db
    .prepare('SELECT model_version FROM layout_blocks WHERE paper_id = ? LIMIT 1')
    .get(paperId) as { model_version: string } | undefined;
  return row?.model_version ?? null;
}

export function deleteLayoutBlocks(
  db: Database.Database,
  paperId: PaperId,
): number {
  return db
    .prepare('DELETE FROM layout_blocks WHERE paper_id = ?')
    .run(paperId).changes;
}

export function hasLayoutBlocks(
  db: Database.Database,
  paperId: PaperId,
): boolean {
  const row = db
    .prepare('SELECT 1 FROM layout_blocks WHERE paper_id = ? LIMIT 1')
    .get(paperId);
  return row !== undefined;
}

// ─── Section Boundaries CRUD ───

export function insertSectionBoundaries(
  db: Database.Database,
  boundaries: SectionBoundaryRow[],
): void {
  const paperIds = Array.from(new Set(boundaries.map((boundary) => boundary.paperId)));
  if (paperIds.length === 0) return;

  const deleteStmt = db.prepare('DELETE FROM section_boundaries WHERE paper_id = ?');

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO section_boundaries
      (paper_id, label, title, depth, char_start, char_end, page_start, page_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchInsert = db.transaction((rows: SectionBoundaryRow[]) => {
    for (const paperId of paperIds) {
      deleteStmt.run(paperId);
    }

    for (const b of rows) {
      stmt.run(
        b.paperId, b.label, b.title, b.depth,
        b.charStart, b.charEnd, b.pageStart, b.pageEnd,
      );
    }
  });

  batchInsert(boundaries);
}

export function getSectionBoundaries(
  db: Database.Database,
  paperId: PaperId,
): SectionBoundaryRow[] {
  const rows = db
    .prepare(`
      SELECT paper_id, label, title, depth,
             char_start, char_end, page_start, page_end
      FROM section_boundaries
      WHERE paper_id = ?
      ORDER BY char_start ASC
    `)
    .all(paperId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    paperId: r['paper_id'] as PaperId,
    label: r['label'] as SectionLabel,
    title: r['title'] as string,
    depth: r['depth'] as number,
    charStart: r['char_start'] as number,
    charEnd: r['char_end'] as number,
    pageStart: r['page_start'] as number,
    pageEnd: r['page_end'] as number,
  }));
}

export function deleteSectionBoundaries(
  db: Database.Database,
  paperId: PaperId,
): number {
  return db
    .prepare('DELETE FROM section_boundaries WHERE paper_id = ?')
    .run(paperId).changes;
}

// ─── Helpers ───

function mapLayoutBlockRow(r: Record<string, unknown>): LayoutBlockRow {
  return {
    paperId: r['paper_id'] as PaperId,
    pageIndex: r['page_index'] as number,
    blockType: r['block_type'] as ContentBlockType,
    bbox: {
      x: r['bbox_x'] as number,
      y: r['bbox_y'] as number,
      w: r['bbox_w'] as number,
      h: r['bbox_h'] as number,
    },
    confidence: r['confidence'] as number,
    readingOrder: r['reading_order'] as number,
    columnIndex: r['column_index'] as number,
    textContent: r['text_content'] as string | null,
    charStart: r['char_start'] as number | null,
    charEnd: r['char_end'] as number | null,
    modelVersion: r['model_version'] as string,
  };
}
