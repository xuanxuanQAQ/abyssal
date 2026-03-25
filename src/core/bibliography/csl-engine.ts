// ═══ CSL 引文格式化引擎 ═══
// §4: citeproc-js 封装 + PaperMetadata → CSL-JSON 映射

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PaperId } from '../types/common';
import type { PaperMetadata, PaperType } from '../types/paper';
import type { FormattedCitation } from '../types/bibliography';
import { CslFormatError } from '../types/errors';

// ─── §4.3.2 姓氏介词（non-dropping-particle） ───

const SURNAME_PREFIXES = new Set([
  'van', 'von', 'de', 'du', 'di', 'del', 'della', 'dos', 'das',
  'den', 'der', 'el', 'al', 'la', 'le',
]);

// ─── §4.3.3 PaperType → CSL type ───

const CSL_TYPE_MAP: Record<PaperType, string> = {
  journal: 'article-journal',
  conference: 'paper-conference',
  book: 'book',
  chapter: 'chapter',
  preprint: 'article',
  review: 'review',
  unknown: 'article',
};

// ─── §4.3.2 作者 → CSL author 对象 ───

interface CslName {
  family?: string | undefined;
  given?: string | undefined;
  literal?: string | undefined;
  'non-dropping-particle'?: string | undefined;
}

function authorToCslName(author: string): CslName {
  const commaIdx = author.indexOf(',');
  if (commaIdx < 0) {
    return { literal: author };
  }

  let family = author.slice(0, commaIdx).trim();
  const given = author.slice(commaIdx + 1).trim();

  // non-dropping-particle 处理
  const words = family.split(/\s+/);
  if (words.length >= 2) {
    const firstWord = words[0]!.toLowerCase();
    if (SURNAME_PREFIXES.has(firstWord)) {
      const particle = words.slice(0, -1).join(' ');
      family = words[words.length - 1]!;
      return { 'non-dropping-particle': particle, family, given };
    }
  }

  return { family, given };
}

// ─── §4.3 PaperMetadata → CSL-JSON ───

interface CslJsonItem {
  id: string;
  type: string;
  title?: string | undefined;
  author?: CslName[] | undefined;
  issued?: { 'date-parts': number[][] } | undefined;
  'container-title'?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  page?: string | undefined;
  DOI?: string | undefined;
  publisher?: string | undefined;
  ISBN?: string | undefined;
  URL?: string | undefined;
  abstract?: string | undefined;
  editor?: CslName[] | undefined;
  'collection-title'?: string | undefined;
  edition?: string | undefined;
}

function paperToCslJson(paper: PaperMetadata): CslJsonItem {
  const item: CslJsonItem = {
    id: paper.id,
    type: CSL_TYPE_MAP[paper.paperType] ?? 'article',
  };

  if (paper.title) item.title = paper.title;
  if (paper.authors.length > 0) {
    item.author = paper.authors.map(authorToCslName);
  }
  if (paper.year) {
    item.issued = { 'date-parts': [[paper.year]] };
  }

  const container = paper.paperType === 'chapter' ? paper.bookTitle : paper.journal;
  if (container) item['container-title'] = container;
  if (paper.volume) item.volume = paper.volume;
  if (paper.issue) item.issue = paper.issue;
  if (paper.pages) item.page = paper.pages;
  if (paper.doi) item.DOI = paper.doi;
  if (paper.publisher) item.publisher = paper.publisher;
  if (paper.isbn) item.ISBN = paper.isbn;
  if (paper.url) item.URL = paper.url;
  if (paper.abstract) item.abstract = paper.abstract;
  if (paper.editors && paper.editors.length > 0) {
    item.editor = paper.editors.map(authorToCslName);
  }
  if (paper.series) item['collection-title'] = paper.series;
  if (paper.edition) item.edition = paper.edition;

  return item;
}

// ─── HTML 去标签 ───
// Fix #1: 仅去除 citeproc-js 输出的已知 HTML 标签，保护 < > 数学符号

function stripHtml(html: string): string {
  return html
    .replace(/<\/?(?:div|span|p|b|i|em|strong|a|sup|sub|br)\b[^>]*>/gi, '')
    .trim();
}

// ═══ CslEngine 类 ═══

export class CslEngine {
  private engine: {
    updateItems(ids: string[]): void;
    processCitationCluster(
      citation: { citationItems: Array<{ id: string }>; properties: { noteIndex: number } },
      pre: unknown[],
      post: unknown[],
    ): Array<[number, string]>;
    makeBibliography(): [unknown, string[]];
  } | null = null;

  private readonly itemMap = new Map<string, CslJsonItem>();
  private readonly styleXml: string;
  private readonly localePath: string;
  private readonly defaultLocale: string;

  constructor(stylePath: string, localePath: string, defaultLocale: string = 'en-US') {
    try {
      this.styleXml = fs.readFileSync(stylePath, 'utf-8');
    } catch (err) {
      throw new CslFormatError({
        message: `Failed to read CSL style file: ${stylePath}`,
        cause: err as Error,
      });
    }
    this.localePath = localePath;
    this.defaultLocale = defaultLocale;
  }

  /** 懒加载 citeproc-js 引擎 */
  private getEngine(): NonNullable<typeof this.engine> {
    if (this.engine) return this.engine;

    // citeproc-js 的 sys 对象
    const self = this;
    const sys = {
      retrieveLocale(lang: string): string | null {
        const filePath = path.join(self.localePath, `locales-${lang}.xml`);
        try {
          return fs.readFileSync(filePath, 'utf-8');
        } catch {
          return null;
        }
      },
      retrieveItem(id: string): CslJsonItem | undefined {
        return self.itemMap.get(id);
      },
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const CSL = require('citeproc');
      this.engine = new CSL.Engine(sys, this.styleXml, this.defaultLocale) as typeof this.engine;
    } catch (err) {
      throw new CslFormatError({
        message: `Failed to initialize citeproc engine: ${(err as Error).message}`,
        cause: err as Error,
      });
    }

    return this.engine!;
  }

  // ─── §4.4 formatCitation ───

  formatCitation(
    papers: Array<{ paperId: PaperId; metadata: PaperMetadata }>,
  ): FormattedCitation[] {
    const engine = this.getEngine();

    // 注册条目
    for (const { paperId, metadata } of papers) {
      this.itemMap.set(paperId, paperToCslJson(metadata));
    }

    const ids = papers.map((p) => p.paperId);
    engine.updateItems(ids);

    // 生成行内引文
    const results: FormattedCitation[] = [];

    for (const { paperId, metadata } of papers) {
      const cluster = {
        citationItems: [{ id: paperId }],
        properties: { noteIndex: 0 },
      };

      let inlineCitation = '';
      try {
        const processed = engine.processCitationCluster(cluster, [], []);
        // processed 格式: [[index, string], ...]
        if (processed.length > 0) {
          inlineCitation = processed[processed.length - 1]![1] ?? '';
        }
      } catch {
        inlineCitation = `(${metadata.authors[0]?.split(',')[0] ?? 'Unknown'}, ${metadata.year})`;
      }

      results.push({
        paperId,
        inlineCitation,
        fullEntry: '', // 下方由 makeBibliography 填充
        cslStyleId: '',
        missingFieldWarnings: [],
      });
    }

    // 生成参考文献条目
    try {
      const bib = engine.makeBibliography();
      const entries = bib[1] ?? [];
      for (let i = 0; i < Math.min(results.length, entries.length); i++) {
        results[i]!.fullEntry = stripHtml(entries[i]!);
      }
    } catch {
      // makeBibliography 失败不阻塞
    }

    return results;
  }

  // ─── §4.5 formatBibliography ───

  formatBibliography(
    papers: Array<{ paperId: PaperId; metadata: PaperMetadata }>,
    format: 'html' | 'text' = 'text',
  ): string {
    const engine = this.getEngine();

    for (const { paperId, metadata } of papers) {
      this.itemMap.set(paperId, paperToCslJson(metadata));
    }

    engine.updateItems(papers.map((p) => p.paperId));

    const bib = engine.makeBibliography();
    const entries = bib[1] ?? [];

    if (format === 'text') {
      return entries.map(stripHtml).join('\n');
    }
    return entries.join('\n');
  }

  // ─── §4.6 getRequiredFields ───

  getRequiredFields(paperType: PaperType): string[] {
    const base = ['authors', 'title', 'year'];

    switch (paperType) {
      case 'journal':
      case 'review':
        return [...base, 'journal'];
      case 'conference':
        return [...base, 'venue'];
      case 'book':
        return [...base, 'publisher'];
      case 'chapter':
        return [...base, 'bookTitle', 'publisher'];
      default:
        return base;
    }
  }
}
