import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDB } from '@test-utils';
import { makePaper } from '@test-utils';
import { addPaper } from '@core/database/dao/papers';
import {
  getLayoutBlocks,
  getSectionBoundaries,
  insertLayoutBlocks,
  insertSectionBoundaries,
  type LayoutBlockRow,
  type SectionBoundaryRow,
} from '@core/database/dao/layout-blocks';

describe('layout-block persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
    addPaper(db, makePaper({ id: 'p1' as never, title: 'Paper 1', source: 'manual' }));
    addPaper(db, makePaper({ id: 'p2' as never, title: 'Paper 2', source: 'manual' }));
  });

  afterEach(() => {
    db.close();
  });

  it('replaces existing blocks for the same paper without duplicating rows', () => {
    insertLayoutBlocks(db, [
      makeBlock('p1', 0, 0, 'Initial abstract'),
      makeBlock('p1', 1, 1, 'Initial body'),
      makeBlock('p2', 0, 0, 'Other paper'),
    ]);

    insertLayoutBlocks(db, [
      makeBlock('p1', 2, 0, 'Reprocessed content'),
    ]);

    const paper1Blocks = getLayoutBlocks(db, 'p1' as never);
    const paper2Blocks = getLayoutBlocks(db, 'p2' as never);

    expect(paper1Blocks).toHaveLength(1);
    expect(paper1Blocks[0]?.textContent).toBe('Reprocessed content');
    expect(paper2Blocks).toHaveLength(1);
    expect(paper2Blocks[0]?.textContent).toBe('Other paper');
  });

  it('replaces section boundaries so stale sections do not survive reprocessing', () => {
    insertSectionBoundaries(db, [
      makeBoundary('p1', 'abstract', 0, 99),
      makeBoundary('p1', 'method', 100, 199),
    ]);

    insertSectionBoundaries(db, [
      makeBoundary('p1', 'result', 200, 299),
    ]);

    const boundaries = getSectionBoundaries(db, 'p1' as never);
    expect(boundaries.map((boundary) => boundary.label)).toEqual(['result']);
  });
});

function makeBlock(
  paperId: string,
  readingOrder: number,
  pageIndex: number,
  textContent: string,
): LayoutBlockRow {
  return {
    paperId: paperId as never,
    pageIndex,
    blockType: 'text',
    bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
    confidence: 0.95,
    readingOrder,
    columnIndex: 0,
    textContent,
    charStart: readingOrder * 10,
    charEnd: readingOrder * 10 + textContent.length,
    modelVersion: 'test-model',
  };
}

function makeBoundary(
  paperId: string,
  label: SectionBoundaryRow['label'],
  charStart: number,
  charEnd: number,
): SectionBoundaryRow {
  return {
    paperId: paperId as never,
    label,
    title: label,
    depth: 1,
    charStart,
    charEnd,
    pageStart: 0,
    pageEnd: 0,
  };
}