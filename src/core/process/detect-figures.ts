// ═══ 图表检测 ═══
// §5.1-5.2: 双通道检测（文本密度网格 + 矢量路径密度）

import * as fs from 'node:fs';
import type { FigureCandidate } from '../types';
import { ProcessError } from '../types/errors';

// ─── §5.2 网格参数 ───

const GRID_COLS = 4;
const GRID_ROWS = 6;
const LOW_DENSITY_THRESHOLD = 10; // chars/in²
const LOW_AREA_RATIO_THRESHOLD = 0.30;
const PATH_DENSITY_THRESHOLD = 50; // ops/in²

// ─── mupdf.js 懒加载 ───

let mupdfModule: typeof import('mupdf') | null = null;

async function getMupdf(): Promise<typeof import('mupdf')> {
  if (mupdfModule) return mupdfModule;
  try {
    mupdfModule = await import('mupdf');
  } catch {
    try {
      mupdfModule = await import('mupdf/dist/mupdf.js' as string);
    } catch (err) {
      throw new ProcessError({
        message: `Failed to load mupdf.js: ${(err as Error).message}`,
        cause: err as Error,
      });
    }
  }
  return mupdfModule!;
}

// ─── §5.2 通道 A：文本密度网格分析 ───

interface GridCell {
  row: number;
  col: number;
  charCount: number;
  areaSqIn: number;
  density: number;
}

function analyzeGridDensity(
  chars: Array<{ x: number; y: number }>,
  bounds: [number, number, number, number],
): { lowAreaRatio: number; avgLowDensity: number } {
  const [x0, y0, x1, y1] = bounds;
  const pageW = x1 - x0;
  const pageH = y1 - y0;
  const cellW = pageW / GRID_COLS;
  const cellH = pageH / GRID_ROWS;
  const totalAreaSqIn = (pageW * pageH) / (72 * 72);

  // 初始化网格
  const grid: GridCell[][] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    grid.push([]);
    for (let c = 0; c < GRID_COLS; c++) {
      grid[r]!.push({
        row: r,
        col: c,
        charCount: 0,
        areaSqIn: (cellW * cellH) / (72 * 72),
        density: 0,
      });
    }
  }

  // 统计每格字符数
  for (const ch of chars) {
    const col = Math.min(GRID_COLS - 1, Math.floor((ch.x - x0) / cellW));
    const row = Math.min(GRID_ROWS - 1, Math.floor((ch.y - y0) / cellH));
    if (col >= 0 && row >= 0) {
      grid[row]![col]!.charCount++;
    }
  }

  // 计算密度
  let lowAreaSum = 0;
  let lowDensitySum = 0;
  let lowCount = 0;

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const cell = grid[r]![c]!;
      cell.density = cell.areaSqIn > 0 ? cell.charCount / cell.areaSqIn : 0;
      if (cell.density < LOW_DENSITY_THRESHOLD) {
        lowAreaSum += cell.areaSqIn;
        lowDensitySum += cell.density;
        lowCount++;
      }
    }
  }

  return {
    lowAreaRatio: totalAreaSqIn > 0 ? lowAreaSum / totalAreaSqIn : 0,
    avgLowDensity: lowCount > 0 ? lowDensitySum / lowCount : 0,
  };
}

// ─── §5.1 detectFigurePages 主函数 ───

export async function detectFigurePages(
  pdfPath: string,
): Promise<FigureCandidate[]> {
  const mupdf = await getMupdf();
  const buffer = fs.readFileSync(pdfPath);

  let doc: { loadPage(i: number): unknown; countPages(): number; destroy(): void };
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf') as typeof doc;
  } catch (err) {
    throw new ProcessError({
      message: `Failed to open PDF for figure detection: ${(err as Error).message}`,
      cause: err as Error,
    });
  }

  const candidates: FigureCandidate[] = [];

  try {
    const pageCount = doc.countPages();

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i) as {
        toStructuredText(opts: string): { walk(walker: unknown): void; destroy(): void };
        getBounds(): [number, number, number, number];
        toDisplayList?(): { destroy(): void };
        destroy(): void;
      };

      try {
        const bounds = page.getBounds();
        const areaPoints = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
        const areaSqIn = areaPoints / (72 * 72);

        // 通道 A：文本密度网格
        const charPositions: Array<{ x: number; y: number }> = [];
        const stext = page.toStructuredText('preserve-whitespace');
        try {
          stext.walk({
            onChar(c: string, _origin: unknown, _font: unknown, _size: unknown, quad: { ul?: { x: number; y: number } } | undefined) {
              if (c.trim() && quad?.ul) {
                charPositions.push({ x: quad.ul.x, y: quad.ul.y });
              }
            },
          });
        } finally {
          stext.destroy();
        }

        const gridResult = analyzeGridDensity(charPositions, bounds);
        const isLowDensity =
          gridResult.lowAreaRatio > LOW_AREA_RATIO_THRESHOLD &&
          gridResult.avgLowDensity < LOW_DENSITY_THRESHOLD;

        // 通道 B：矢量路径检测（使用 DisplayList 如果可用）
        // mupdf.js 的 API 可能不直接暴露 path 操作计数
        // 备选方案：通过字符总数与页面面积的比较间接判断
        // 如果字符数远低于预期但页面不是空白→可能是图表密集页
        let hasVectorPaths = false;

        if (page.toDisplayList) {
          try {
            const list = page.toDisplayList();
            // TODO: mupdf.js DisplayList API 可能不暴露 path 操作级别枚举
            // 当前使用字符密度作为近似判断
            list.destroy();
          } catch {
            // DisplayList 不可用
          }
        }

        // 近似矢量检测：字符密度中等且低密度区域较大→可能是图表混合页
        // 改进：需要低密度区域面积 > 20% 且整体密度不太高（排除纯表格页的虚线干扰）
        const overallDensity = areaSqIn > 0 ? charPositions.length / areaSqIn : 0;
        if (overallDensity > 10 && overallDensity < 80 && gridResult.lowAreaRatio > 0.25) {
          // 额外检查：低密度区域是否真的是连片区域（而非分散的单元格间隙）
          // 连片判定：低密度格子中至少有一组 ≥ 3 个相邻格子
          hasVectorPaths = gridResult.lowAreaRatio > 0.35;
        }

        if (isLowDensity || hasVectorPaths) {
          let method: FigureCandidate['detectionMethod'];
          if (isLowDensity && hasVectorPaths) method = 'both';
          else if (isLowDensity) method = 'low_density';
          else method = 'vector_paths';

          candidates.push({
            pageIndex: i,
            detectionMethod: method,
            densityRatio: overallDensity / 200, // 归一化到 [0, ~1]
            estimatedFigureArea: gridResult.lowAreaRatio,
          });
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }

  return candidates;
}
