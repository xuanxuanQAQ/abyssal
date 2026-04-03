// ═══ OCR Lines DAO ═══
//
// Persists Tesseract OCR line-level bounding boxes for scanned pages.
// Used by the reader's OcrTextLayer for aligned text overlay.

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import type { NormalizedBBox, OcrWord } from '../../dla/types';

// ─── Types ───

export interface OcrLineRow {
  paperId: PaperId;
  pageIndex: number;
  lineIndex: number;
  text: string;
  bbox: NormalizedBBox;
  confidence: number;
  words?: OcrWord[];
}

// ─── CRUD ───

export function insertOcrLines(
  db: Database.Database,
  lines: OcrLineRow[],
): void {
  if (lines.length === 0) return;

  const paperIds = Array.from(new Set(lines.map((l) => l.paperId)));
  const deleteStmt = db.prepare('DELETE FROM ocr_lines WHERE paper_id = ?');

  const stmt = db.prepare(`
    INSERT INTO ocr_lines
      (paper_id, page_index, line_index, text, bbox_x, bbox_y, bbox_w, bbox_h, confidence, words_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchInsert = db.transaction((rows: OcrLineRow[]) => {
    for (const paperId of paperIds) {
      deleteStmt.run(paperId);
    }

    for (const l of rows) {
      stmt.run(
        l.paperId, l.pageIndex, l.lineIndex,
        l.text,
        l.bbox.x, l.bbox.y, l.bbox.w, l.bbox.h,
        l.confidence,
        l.words ? JSON.stringify(l.words) : null,
      );
    }
  });

  batchInsert(lines);
}

export function getOcrLinesByPage(
  db: Database.Database,
  paperId: PaperId,
  pageIndex: number,
): OcrLineRow[] {
  const rows = db
    .prepare(`
      SELECT paper_id, page_index, line_index, text,
             bbox_x, bbox_y, bbox_w, bbox_h, confidence, words_json
      FROM ocr_lines
      WHERE paper_id = ? AND page_index = ?
      ORDER BY line_index ASC
    `)
    .all(paperId, pageIndex) as Array<Record<string, unknown>>;

  return rows.map(mapOcrLineRow);
}

export function getOcrLines(
  db: Database.Database,
  paperId: PaperId,
): OcrLineRow[] {
  const rows = db
    .prepare(`
      SELECT paper_id, page_index, line_index, text,
             bbox_x, bbox_y, bbox_w, bbox_h, confidence, words_json
      FROM ocr_lines
      WHERE paper_id = ?
      ORDER BY page_index ASC, line_index ASC
    `)
    .all(paperId) as Array<Record<string, unknown>>;

  return rows.map(mapOcrLineRow);
}

export function hasOcrLines(
  db: Database.Database,
  paperId: PaperId,
): boolean {
  const row = db
    .prepare('SELECT 1 FROM ocr_lines WHERE paper_id = ? LIMIT 1')
    .get(paperId);
  return row !== undefined;
}

export function deleteOcrLines(
  db: Database.Database,
  paperId: PaperId,
): number {
  return db
    .prepare('DELETE FROM ocr_lines WHERE paper_id = ?')
    .run(paperId).changes;
}

// ─── Helpers ───

function mapOcrLineRow(r: Record<string, unknown>): OcrLineRow {
  const wordsJson = r['words_json'] as string | null;
  let words: OcrWord[] | undefined;
  if (wordsJson) {
    try { words = JSON.parse(wordsJson) as OcrWord[]; } catch { /* ignore corrupt JSON */ }
  }
  return {
    paperId: r['paper_id'] as PaperId,
    pageIndex: r['page_index'] as number,
    lineIndex: r['line_index'] as number,
    text: r['text'] as string,
    bbox: {
      x: r['bbox_x'] as number,
      y: r['bbox_y'] as number,
      w: r['bbox_w'] as number,
      h: r['bbox_h'] as number,
    },
    confidence: r['confidence'] as number,
    ...(words ? { words } : {}),
  };
}
