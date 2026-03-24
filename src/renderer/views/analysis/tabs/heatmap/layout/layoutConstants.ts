/**
 * Heatmap layout constants.
 *
 * Extracted to a leaf module to avoid circular dependencies between
 * HeatmapGrid and its child components (ColumnHeader, RowHeader, etc.).
 */

export const CELL_WIDTH = 32;
export const CELL_HEIGHT = 28;
export const CELL_GAP = 1;
export const ROW_HEADER_WIDTH = 200;
export const COLUMN_HEADER_HEIGHT = 120;
export const CONCEPT_GROUP_GAP = 8;
export const OVERSCAN_FACTOR = 1.5;
export const REPAINT_THRESHOLD_RATIO = 0.25;
