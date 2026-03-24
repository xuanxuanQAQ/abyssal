import { CELL_WIDTH, CELL_HEIGHT, CELL_GAP } from '../layout/layoutConstants';

export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  startCol: number,
  endCol: number,
  startRow: number,
  endRow: number,
  anchorScrollLeft: number,
  anchorScrollTop: number,
  overscanX: number,
  overscanY: number,
  rowOffsets: number[],
): void {
  const stride = CELL_WIDTH + CELL_GAP;

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(128,128,128,0.08)';
  ctx.lineWidth = 1;

  // Vertical lines
  for (let c = startCol; c <= endCol + 1; c++) {
    const x = Math.floor(c * stride - anchorScrollLeft + overscanX) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
  }

  // Horizontal lines
  for (let r = startRow; r <= endRow + 1; r++) {
    if (r < rowOffsets.length) {
      const y = Math.floor(rowOffsets[r]! - anchorScrollTop + overscanY) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
    }
  }

  ctx.stroke();
}
