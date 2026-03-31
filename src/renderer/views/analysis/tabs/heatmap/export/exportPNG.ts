import type { HeatmapCell } from '../../../../../../shared-types/models';
import type { AdjudicationStatus } from '../../../../../../shared-types/enums';
import { cellKey } from '../../../shared/cellKey';
import {
  CELL_WIDTH,
  CELL_HEIGHT,
  CELL_GAP,
  ROW_HEADER_WIDTH,
  COLUMN_HEADER_HEIGHT,
} from '../layout/layoutConstants';
import { drawCell } from '../canvas/cellRenderer';

const LABEL_FONT = '11px system-ui, sans-serif';
const HEADER_FONT = '10px system-ui, sans-serif';
const LABEL_COLOR = '#333';
const GRID_BG = '#fafafa';

/**
 * Export the full heatmap as a PNG image.
 *
 * Creates a temporary off-screen canvas large enough to render every cell
 * plus row/column labels, draws the full matrix, converts to a Blob,
 * and triggers a download.
 */
export async function exportHeatmapPNG(
  cells: HeatmapCell[],
  numPapers: number,
  numConcepts: number,
  rowOffsets: number[],
  getAdjudicationStatus: (id: string) => AdjudicationStatus,
  paperLabels: string[],
  conceptNames: string[],
): Promise<void> {
  const stride = CELL_WIDTH + CELL_GAP;
  const gridWidth = numPapers * stride;
  const gridHeight =
    numConcepts > 0
      ? (rowOffsets[numConcepts - 1] ?? 0) + CELL_HEIGHT
      : 0;

  const totalWidth = ROW_HEADER_WIDTH + gridWidth;
  const totalHeight = COLUMN_HEADER_HEIGHT + gridHeight;

  // Guard against absurdly large exports
  const MAX_PIXELS = 16384;
  if (totalWidth > MAX_PIXELS || totalHeight > MAX_PIXELS) {
    throw new Error(
      `Export dimensions (${totalWidth}x${totalHeight}) exceed maximum supported size (${MAX_PIXELS}px).`,
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to obtain 2D rendering context for export.');

  // Background
  ctx.fillStyle = GRID_BG;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // --- Draw column headers (paper labels, rotated) ---
  ctx.save();
  ctx.font = HEADER_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let col = 0; col < numPapers; col++) {
    const label = paperLabels[col] ?? `P${col}`;
    const x = ROW_HEADER_WIDTH + col * stride + CELL_WIDTH / 2;
    const y = COLUMN_HEADER_HEIGHT - 4;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 3);
    ctx.fillText(label.length > 20 ? label.slice(0, 18) + '...' : label, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // --- Draw row headers (concept names) ---
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < numConcepts; row++) {
    const label = conceptNames[row] ?? `C${row}`;
    const rowY = COLUMN_HEADER_HEIGHT + (rowOffsets[row] ?? 0) + CELL_HEIGHT / 2;
    const truncated = label.length > 18 ? label.slice(0, 16) + '...' : label;
    ctx.fillText(truncated, ROW_HEADER_WIDTH - 8, rowY);
  }
  ctx.restore();

  // --- Draw cells ---
  // Build a lookup map for O(1) cell access
  const cellMap = new Map<string, HeatmapCell>();
  for (const cell of cells) {
    cellMap.set(cellKey(cell.conceptIndex, cell.paperIndex), cell);
  }

  for (let row = 0; row < numConcepts; row++) {
    for (let col = 0; col < numPapers; col++) {
      const cell = cellMap.get(cellKey(row, col));
      if (!cell) continue;

      const x = ROW_HEADER_WIDTH + col * stride;
      const y = COLUMN_HEADER_HEIGHT + (rowOffsets[row] ?? 0);
      const status = getAdjudicationStatus(cell.mappingId);
      drawCell(ctx, x, y, cell.relationType, cell.confidence, status);
    }
  }

  // --- Convert to blob and trigger download ---
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('canvas.toBlob returned null'));
      },
      'image/png',
    );
  });

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `heatmap-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}
