import { CELL_WIDTH, CELL_HEIGHT } from '../layout/layoutConstants';

export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cellCanvasX: number,
  cellCanvasY: number,
  isDark: boolean,
): void {
  const x = Math.floor(cellCanvasX);
  const y = Math.floor(cellCanvasY);

  // Row highlight band
  const bandColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  ctx.fillStyle = bandColor;
  ctx.fillRect(0, y, canvasWidth, CELL_HEIGHT);

  // Column highlight band
  ctx.fillRect(x, 0, CELL_WIDTH, canvasHeight);

  // Focus cell border
  ctx.strokeStyle = 'rgb(99,102,241)'; // accent color
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, CELL_WIDTH - 2, CELL_HEIGHT - 2);
}

export function drawSelectionBorder(
  ctx: CanvasRenderingContext2D,
  canvasX: number,
  canvasY: number,
): void {
  const x = Math.floor(canvasX);
  const y = Math.floor(canvasY);
  ctx.strokeStyle = 'rgb(99,102,241)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, CELL_WIDTH, CELL_HEIGHT);
}

export function drawKeyboardFocus(
  ctx: CanvasRenderingContext2D,
  canvasX: number,
  canvasY: number,
): void {
  const x = Math.floor(canvasX);
  const y = Math.floor(canvasY);
  ctx.setLineDash([3, 2]);
  ctx.strokeStyle = 'rgb(99,102,241)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, CELL_WIDTH, CELL_HEIGHT);
  ctx.setLineDash([]);
}
