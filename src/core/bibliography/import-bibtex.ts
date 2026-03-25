// ═══ BibTeX 导入 ═══
// §1.1: @retorquere/bibtex-parser 解析 + 字段映射 + PaperId 生成

import type { PaperMetadata, PaperType } from '../types/paper';
import type { ImportedEntry } from '../types/bibliography';
import { BibtexParseError } from '../types/errors';
import { generatePaperId, normalizeDoi, normalizeArxivId } from '../search/paper-id';

// ─── §1.1.2 BibTeX type → PaperType ───

const BIBTEX_TYPE_MAP: Record<string, PaperType> = {
  article: 'journal',
  inproceedings: 'conference',
  conference: 'conference',
  book: 'book',
  incollection: 'chapter',
  inbook: 'chapter',
  techreport: 'preprint',
  mastersthesis: 'preprint',
  phdthesis: 'preprint',
  misc: 'unknown',
  unpublished: 'unknown',
  proceedings: 'book',
};

// ─── §1.1.3 已知映射字段 ───

const MAPPED_FIELDS = new Set([
  'title', 'author', 'year', 'doi', 'eprint', 'eprinttype',
  'abstract', 'journal', 'journaltitle', 'volume', 'number', 'issue',
  'pages', 'publisher', 'isbn', 'issn', 'edition', 'editor',
  'booktitle', 'series', 'url', 'note', 'keywords', 'annote', 'annotation',
]);

// ─── 作者解析 ───

function parseAuthors(
  creators: Array<{ firstName?: string; lastName?: string; literal?: string }> | undefined,
): string[] {
  if (!creators || creators.length === 0) return [];
  return creators.map((c) => {
    if (c.literal) return c.literal;
    const last = c.lastName ?? '';
    const first = c.firstName ?? '';
    return first ? `${last}, ${first}` : last;
  });
}

// ─── §1.1 importBibtex ───

export function importBibtex(input: string): ImportedEntry[] {
  let parsed: {
    entries: Array<{
      key: string;
      type: string;
      fields: Record<string, unknown>;
      creators?: { author?: Array<{ firstName?: string; lastName?: string; literal?: string }>; editor?: Array<{ firstName?: string; lastName?: string; literal?: string }> };
    }>;
  };

  try {
    // @retorquere/bibtex-parser
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bibtexParser = require('@retorquere/bibtex-parser');
    parsed = bibtexParser.parse(input, { sentenceCase: false });
  } catch (err) {
    throw new BibtexParseError({
      message: `BibTeX parse failed: ${(err as Error).message}`,
      cause: err as Error,
    });
  }

  const results: ImportedEntry[] = [];

  for (const entry of parsed.entries) {
    const fields = entry.fields;
    const f = (key: string): string | null => {
      const v = fields[key];
      if (v === undefined || v === null) return null;
      const s = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
      return s.trim() || null;
    };

    const paperType = BIBTEX_TYPE_MAP[entry.type.toLowerCase()] ?? 'unknown';
    const doi = f('doi') ? normalizeDoi(f('doi')!) : null;
    const eprintType = f('eprinttype')?.toLowerCase();
    const arxivId = eprintType === 'arxiv' && f('eprint')
      ? normalizeArxivId(f('eprint')!)
      : null;
    const title = f('title') ?? '';

    const yearStr = f('year');
    const year = yearStr ? parseInt(yearStr.replace(/[^0-9]/g, '').slice(0, 4), 10) || 0 : 0;

    const pages = f('pages')?.replace(/--/g, '-') ?? null;

    const authors = parseAuthors(entry.creators?.author);
    const editors = parseAuthors(entry.creators?.editor);

    const metadata: Partial<PaperMetadata> = {
      id: generatePaperId(doi, arxivId, title || null),
      title,
      authors,
      year,
      doi,
      arxivId,
      abstract: f('abstract'),
      paperType,
      source: 'bibtex',
      journal: f('journal') ?? f('journaltitle'),
      volume: f('volume'),
      issue: f('number') ?? f('issue'),
      pages,
      publisher: f('publisher'),
      isbn: f('isbn'),
      issn: f('issn'),
      edition: f('edition'),
      editors: editors.length > 0 ? editors : null,
      bookTitle: f('booktitle'),
      series: f('series'),
      url: f('url'),
      venue: null,
      citationCount: null,
      pmid: null,
      pmcid: null,
      bibtexKey: entry.key,
      biblioComplete: false,
    };

    // 未映射字段
    const unmappedFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!MAPPED_FIELDS.has(key.toLowerCase()) && value != null) {
        unmappedFields[key] = String(value);
      }
    }

    results.push({
      originalKey: entry.key,
      metadata,
      unmappedFields,
      sourceFormat: 'bibtex',
    });
  }

  return results;
}
