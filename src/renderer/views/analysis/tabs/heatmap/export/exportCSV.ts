import type { HeatmapCell } from '../../../../../../shared-types/models';

/**
 * Export the heatmap matrix as a CSV file.
 *
 * Generates a CSV where:
 * - Rows correspond to concepts
 * - Columns correspond to papers
 * - Each cell value is "{relationType}:{confidence}" or empty if no mapping exists
 *
 * The first column contains concept names; the first row contains paper labels.
 */
export function exportHeatmapCSV(
  cells: HeatmapCell[],
  paperIds: string[],
  conceptIds: string[],
  paperLabels: string[],
  conceptNames: string[],
): void {
  const numPapers = paperIds.length;
  const numConcepts = conceptIds.length;

  // Build a lookup map: "conceptIndex:paperIndex" -> HeatmapCell
  const cellMap = new Map<string, HeatmapCell>();
  for (const cell of cells) {
    cellMap.set(`${cell.conceptIndex}:${cell.paperIndex}`, cell);
  }

  const lines: string[] = [];

  // Header row: empty corner cell + paper labels
  const headerCells = ['Concept'];
  for (let col = 0; col < numPapers; col++) {
    headerCells.push(escapeCSV(paperLabels[col] ?? paperIds[col] ?? `P${col}`));
  }
  lines.push(headerCells.join(','));

  // Data rows: one per concept
  for (let row = 0; row < numConcepts; row++) {
    const rowCells: string[] = [
      escapeCSV(conceptNames[row] ?? conceptIds[row] ?? `C${row}`),
    ];
    for (let col = 0; col < numPapers; col++) {
      const cell = cellMap.get(`${row}:${col}`);
      if (cell) {
        rowCells.push(`${cell.relationType}:${cell.confidence.toFixed(2)}`);
      } else {
        rowCells.push('');
      }
    }
    lines.push(rowCells.join(','));
  }

  const csvContent = lines.join('\n');

  // Trigger download with BOM for Excel compatibility
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `heatmap-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Escape a string for CSV: wrap in quotes if it contains commas, quotes, or newlines.
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
