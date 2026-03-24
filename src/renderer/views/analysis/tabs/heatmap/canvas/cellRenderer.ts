import type { AdjudicationStatus, RelationType } from '../../../../../../shared-types/enums';
import { getCellColor } from './colorMap';
import { CELL_WIDTH, CELL_HEIGHT } from '../layout/layoutConstants';

export function drawCell(
  ctx: CanvasRenderingContext2D,
  canvasX: number,
  canvasY: number,
  relationType: RelationType,
  confidence: number,
  adjudicationStatus: AdjudicationStatus,
): void {
  // Pixel-aligned coordinates
  const x = Math.floor(canvasX);
  const y = Math.floor(canvasY);

  ctx.fillStyle = getCellColor(relationType, confidence);
  ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);

  // Draw adjudication indicators
  drawAdjudicationIndicator(ctx, x, y, adjudicationStatus);
}

function drawAdjudicationIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  status: AdjudicationStatus,
): void {
  switch (status) {
    case 'accepted': {
      // White checkmark in bottom-right 8x8 area
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('\u2713', x + CELL_WIDTH - 2, y + CELL_HEIGHT - 1);
      break;
    }
    case 'rejected': {
      // Semi-transparent red diagonal line
      ctx.strokeStyle = 'rgba(239,68,68,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + CELL_WIDTH - 2, y + CELL_HEIGHT - 2);
      ctx.moveTo(x + CELL_WIDTH - 2, y + 2);
      ctx.lineTo(x + 2, y + CELL_HEIGHT - 2);
      ctx.stroke();
      break;
    }
    case 'revised': {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('\u270F', x + CELL_WIDTH - 2, y + CELL_HEIGHT - 1);
      break;
    }
    case 'pending':
    default:
      break;
  }
}
