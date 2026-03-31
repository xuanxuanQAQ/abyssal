/**
 * Shared utility for generating heatmap cell lookup keys.
 * Eliminates the repeated `${row}:${col}` pattern across 4+ files.
 */
export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}
