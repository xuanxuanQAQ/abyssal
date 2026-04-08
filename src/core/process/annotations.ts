// ═══ PDF 标注读写 ═══
// §6: readAnnotations + writeAnnotation（mupdf.js 标注 API）

import * as fs from 'node:fs';
import type { PdfAnnotationRaw } from './types';
import type { PdfRect } from '../types/annotation';
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

// ─── §6.1 矩形相交判定 ───

function rectsIntersect(a: PdfRect, b: PdfRect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// ─── §6.1 readAnnotations ───

export async function readAnnotations(
  pdfPath: string,
): Promise<PdfAnnotationRaw[]> {
  const mupdf = await getMupdf();
  const buffer = fs.readFileSync(pdfPath);

  let doc: { loadPage(i: number): unknown; countPages(): number; destroy(): void };
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf') as typeof doc;
  } catch (err) {
    throw new ProcessError({
      message: `Failed to open PDF for annotations: ${(err as Error).message}`,
      cause: err as Error,
    });
  }

  const results: PdfAnnotationRaw[] = [];

  try {
    const pageCount = doc.countPages();

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i) as {
        getAnnotations(): Array<{
          getType(): string;
          getBounds(): [number, number, number, number];
          getContents?(): string;
          getColor?(): number[];
          getModificationDate?(): string;
        }>;
        toStructuredText(opts: string): { walk(walker: unknown): void; destroy(): void };
        destroy(): void;
      };

      try {
        // 获取该页标注
        let annots: ReturnType<typeof page.getAnnotations>;
        try {
          annots = page.getAnnotations();
        } catch {
          continue; // 标注 API 不可用
        }

        // 获取结构化文本（用于 selectedText 提取）
        const charData: Array<{ char: string; rect: PdfRect }> = [];
        const stext = page.toStructuredText('preserve-whitespace');
        try {
          stext.walk({
            onChar(c: string, _origin: unknown, _font: unknown, _size: unknown, quad: { ul?: { x: number; y: number }; lr?: { x: number; y: number } } | undefined) {
              if (quad?.ul && quad?.lr) {
                charData.push({
                  char: c,
                  rect: { x0: quad.ul.x, y0: quad.ul.y, x1: quad.lr.x, y1: quad.lr.y },
                });
              }
            },
          });
        } finally {
          stext.destroy();
        }

        for (const annot of annots) {
          const type = annot.getType();
          // §6.1: 仅保留 Highlight 和 FreeText
          if (type !== 'Highlight' && type !== 'FreeText') continue;

          const bounds = annot.getBounds();
          const annotRect: PdfRect = {
            x0: bounds[0],
            y0: bounds[1],
            x1: bounds[2],
            y1: bounds[3],
          };

          // selectedText：在结构化文本中空间查询
          let selectedText = '';
          for (const ch of charData) {
            if (rectsIntersect(annotRect, ch.rect)) {
              selectedText += ch.char;
            }
          }

          // 颜色
          let color: [number, number, number] | null = null;
          try {
            const c = annot.getColor?.();
            if (c && c.length >= 3) {
              color = [c[0]!, c[1]!, c[2]!];
            }
          } catch {
            // 颜色不可用
          }

          // 内容
          let contents: string | null = null;
          try {
            contents = annot.getContents?.() ?? null;
          } catch {
            // 内容不可用
          }

          // 创建日期
          let createdDate: string | null = null;
          try {
            createdDate = annot.getModificationDate?.() ?? null;
          } catch {
            // 日期不可用
          }

          results.push({
            page: i,
            type: type === 'Highlight' ? 'highlight' : 'note',
            rect: annotRect,
            contents,
            selectedText: selectedText.trim(),
            color,
            createdDate,
          });
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }

  return results;
}

// ─── §6.2 writeAnnotation ───

export interface WriteAnnotationData {
  page: number;
  type: 'highlight' | 'note';
  rect: PdfRect;
  text: string;
  color?: string | undefined; // CSS 颜色值
}

export async function writeAnnotation(
  pdfPath: string,
  data: WriteAnnotationData,
): Promise<void> {
  const mupdf = await getMupdf();
  const buffer = fs.readFileSync(pdfPath);

  let doc: {
    loadPage(i: number): unknown;
    save(path: string, opts: string): void;
    destroy(): void;
  };
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf') as unknown as typeof doc;
  } catch (err) {
    throw new ProcessError({
      message: `Failed to open PDF for writing: ${(err as Error).message}`,
      cause: err as Error,
    });
  }

  try {
    const page = doc.loadPage(data.page) as {
      createAnnotation(type: string): {
        setBounds(rect: [number, number, number, number]): void;
        setContents?(text: string): void;
        setColor?(color: number[]): void;
      };
      destroy(): void;
    };

    try {
      const annotType = data.type === 'highlight' ? 'Highlight' : 'FreeText';
      const annot = page.createAnnotation(annotType);

      annot.setBounds([data.rect.x0, data.rect.y0, data.rect.x1, data.rect.y1]);

      if (data.text && annot.setContents) {
        annot.setContents(data.text);
      }

      // §6.2: 增量保存
      doc.save(pdfPath, 'incremental');
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}
