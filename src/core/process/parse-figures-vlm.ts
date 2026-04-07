// ═══ VLM 图表解析 ═══
// §5.3-5.6: 渲染 PNG → VLM prompt → 解析 Markdown → FigureBlock

import * as fs from 'node:fs';
import type { FigureBlock, FigureCandidate } from './types';
import type { VisionCapable } from '../types/common';
import { ProcessError } from '../types/errors';

// ─── mupdf.js 懒加载 ───

let mupdfModule: typeof import('mupdf') | null = null;

async function getMupdf(): Promise<typeof import('mupdf')> {
  if (mupdfModule) return mupdfModule;
  try {
    mupdfModule = await import('mupdf');
  } catch {
    try {
      const fallbackSpecifier = 'mupdf/dist/mupdf.js';
      mupdfModule = await import(/* @vite-ignore */ fallbackSpecifier);
    } catch (err) {
      throw new ProcessError({
        message: `Failed to load mupdf.js: ${(err as Error).message}`,
        cause: err as Error,
      });
    }
  }
  return mupdfModule!;
}

// ─── §5.4 VLM Prompt ───

const VLM_PROMPT = `You are analyzing a page from an academic paper. This page contains figures, tables, or diagrams.

For each distinct figure or table on this page, provide:
1. Figure/Table type (figure / table / equation / algorithm)
2. Caption or title (if visible)
3. A detailed structural description in Markdown format:
   - For tables: reproduce the table in Markdown table syntax
   - For figures: describe the axes, data series, trends, and key data points
   - For diagrams: describe the components, connections, and flow
   - For equations: reproduce in LaTeX notation

Output each figure/table as a separate section with a heading.`;

// ─── §5.4 解析 VLM 输出 ───

function parseVlmOutput(
  vlmText: string,
  pageIndex: number,
): FigureBlock[] {
  // 按一级/二级标题分割
  const sections = vlmText.split(/^#{1,2}\s+/m).filter((s) => s.trim().length > 0);

  if (sections.length === 0) {
    // 无标题分隔→整个响应作为单个 FigureBlock
    return [{
      pageIndex,
      type: detectFigureType(vlmText),
      rect: null,
      description: vlmText.trim(),
      imagePath: null,
      captionText: null,
      ocrText: null,
    }];
  }

  return sections.map((section) => {
    const lines = section.trim().split('\n');
    const titleLine = lines[0] ?? '';
    const body = lines.slice(1).join('\n').trim();

    return {
      pageIndex,
      type: detectFigureType(titleLine),
      rect: null,
      description: body || section.trim(),
      imagePath: null,
      captionText: extractCaption(section),
      ocrText: null,
    };
  });
}

function detectFigureType(text: string): FigureBlock['type'] {
  const lower = text.toLowerCase();
  if (lower.includes('table')) return 'table';
  if (lower.includes('equation') || lower.includes('formula')) return 'equation';
  if (lower.includes('algorithm')) return 'algorithm';
  return 'figure';
}

function extractCaption(text: string): string | null {
  // 尝试从 VLM 输出中提取 "Caption:" 或 "Figure X:" 模式
  const captionMatch = /(?:caption|title)[:\s]+(.+)/i.exec(text);
  if (captionMatch) return captionMatch[1]!.trim();

  const figMatch = /(?:figure|table)\s+\d+[.:]\s*(.+)/i.exec(text);
  if (figMatch) return figMatch[1]!.trim();

  return null;
}

// ─── §5.3 parseFiguresWithVlm 主函数 ───

export interface ParseFiguresOptions {
  maxTokensPerPage?: number | undefined;
  /** 渲染 PNG 的保存目录。null 时不保存文件 */
  figuresDir?: string | null | undefined;
}

export async function parseFiguresWithVlm(
  pdfPath: string,
  candidates: FigureCandidate[],
  vlm: VisionCapable,
  options: ParseFiguresOptions = {},
): Promise<FigureBlock[]> {
  if (candidates.length === 0) return [];

  const maxTokens = options.maxTokensPerPage ?? 1024;
  const figuresDir = options.figuresDir ?? null;
  const mupdf = await getMupdf();
  const buffer = await fs.promises.readFile(pdfPath);

  let doc: { loadPage(i: number): unknown; destroy(): void };
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf') as typeof doc;
  } catch (err) {
    throw new ProcessError({
      message: `Failed to open PDF for VLM: ${(err as Error).message}`,
      cause: err as Error,
    });
  }

  const allBlocks: FigureBlock[] = [];

  try {
    for (const candidate of candidates) {
      const page = doc.loadPage(candidate.pageIndex) as {
        toPixmap(matrix: unknown, colorspace: unknown, alpha?: boolean): { asPNG(): Buffer; destroy(): void };
        destroy(): void;
      };

      try {
        // §5.4 步骤 1：渲染 150 DPI PNG
        const scale = 150 / 72;
        const pixmap = page.toPixmap(
          [scale, 0, 0, scale, 0, 0],
          (mupdf as { ColorSpace?: { DeviceRGB?: unknown } }).ColorSpace?.DeviceRGB ?? 'DeviceRGB' as unknown,
        );

        let pngBuffer: Buffer;
        try {
          pngBuffer = pixmap.asPNG();
        } finally {
          pixmap.destroy();
        }

        // 可选：保存 PNG
        let imagePath: string | null = null;
        if (figuresDir) {
          await fs.promises.mkdir(figuresDir, { recursive: true });
          imagePath = `${figuresDir}/page_${candidate.pageIndex}.png`;
          await fs.promises.writeFile(imagePath, pngBuffer);
        }

        // §5.4 步骤 2-3：VLM 调用
        const pngBase64 = pngBuffer.toString('base64');
        let description: string;
        try {
          description = await vlm.describeImage(
            pngBase64,
            'image/png',
            VLM_PROMPT,
            maxTokens,
          );
        } catch (vlmErr) {
          console.warn(`[VLM] Failed to analyze page ${candidate.pageIndex}: ${(vlmErr as Error).message}`);
          continue;
        }

        // §5.4 步骤 4：解析 VLM 输出
        const blocks = parseVlmOutput(description, candidate.pageIndex);
        for (const block of blocks) {
          block.imagePath = imagePath;
          allBlocks.push(block);
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }

  return allBlocks;
}
