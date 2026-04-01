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

// ─── LaTeX 命令解码 ───
// Fix #2: 将常见 LaTeX 命令转为 Unicode，避免 title/author 中出现原始 LaTeX 源码

const LATEX_ACCENT_MAP: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', y: 'ý', Y: 'Ý' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü', y: 'ÿ' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  'c': { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş' },
  'v': { c: 'č', s: 'š', z: 'ž', C: 'Č', S: 'Š', Z: 'Ž', r: 'ř', R: 'Ř' },
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' },
  '.': { z: 'ż', Z: 'Ż' },
  'u': { a: 'ă', g: 'ğ', A: 'Ă', G: 'Ğ' },
  'H': { o: 'ő', u: 'ű', O: 'Ő', U: 'Ű' },
};

const LATEX_COMMANDS: Record<string, string> = {
  '\\ss': 'ß', '\\ae': 'æ', '\\AE': 'Æ', '\\oe': 'œ', '\\OE': 'Œ',
  '\\o': 'ø', '\\O': 'Ø', '\\aa': 'å', '\\AA': 'Å', '\\l': 'ł', '\\L': 'Ł',
  '\\i': 'ı', '\\j': 'ȷ',
  '\\&': '&', '\\%': '%', '\\$': '$', '\\#': '#', '\\_': '_',
  '---': '—', '--': '–', '``': '"', "''": '"', '~': '\u00A0',
};

function decodeLatex(text: string): string {
  let result = text;

  // 1. 处理 accent 命令: \'{e}, \"{o}, \^{a}, \c{c} 等
  // 格式: \\accent{char} 或 \\accent char（无花括号）
  result = result.replace(/\\([`'^"~cvuH.=])(?:\{([a-zA-Z])\}|([a-zA-Z]))/g,
    (_match, accent: string, bracedChar: string | undefined, bareChar: string | undefined) => {
      const ch = bracedChar ?? bareChar ?? '';
      const map = LATEX_ACCENT_MAP[accent];
      return map?.[ch] ?? ch;
    },
  );

  // 2. 处理命名命令：\ss, \ae, \o 等
  for (const [cmd, replacement] of Object.entries(LATEX_COMMANDS)) {
    // 转义正则特殊字符并添加单词边界检查
    const escaped = cmd.replace(/[\\$^.*+?()[\]{}|]/g, '\\$&');
    // 对于 \cmd 形式，后面必须是非字母（避免 \oe 匹配 \omega 的前缀）
    const re = cmd.startsWith('\\')
      ? new RegExp(escaped + '(?![a-zA-Z])', 'g')
      : new RegExp(escaped, 'g');
    result = result.replace(re, replacement);
  }

  // 3. 处理 \textbf{}, \textit{}, \emph{} 等格式命令——去除命令保留内容
  result = result.replace(/\\(?:text(?:bf|it|rm|sf|tt|sc)|emph|mbox)\{([^}]*)\}/g, '$1');

  // 4. 去除保护大括号 {text} → text（嵌套处理：先内后外）
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(/\{([^{}]*)\}/g, '$1');
  }

  // 5. 处理 $..$ 内的简单数学（保留内容但去除 $）
  result = result.replace(/\$([^$]+)\$/g, '$1');

  return result.trim();
}

// ─── 作者解析 ───

function parseAuthors(
  creators: Array<{ firstName?: string; lastName?: string; literal?: string }> | undefined,
): string[] {
  if (!creators || creators.length === 0) return [];
  return creators.map((c) => {
    if (c.literal) return decodeLatex(c.literal);
    const last = c.lastName ? decodeLatex(c.lastName) : '';
    const first = c.firstName ? decodeLatex(c.firstName) : '';
    return first ? `${last}, ${first}` : last;
  });
}

// ─── 年份解析 ───
// Fix #3: 解析失败返回 null 而非 0

function parseYear(yearStr: string | null): number | null {
  if (!yearStr) return null;
  const digits = yearStr.replace(/[^0-9]/g, '').slice(0, 4);
  if (digits.length < 4) return null;
  const year = parseInt(digits, 10);
  if (year < 1000 || year > 2100) return null;
  return year;
}

// ─── §1.1 importBibtex ───

export function importBibtex(input: string): ImportedEntry[] {
  // Fix #1: 使用 errorHandler 回调跳过坏条目，而非整体 throw
  const parseErrors: Array<{ message: string }> = [];

  let parsed: {
    entries: Array<{
      key: string;
      type: string;
      fields: Record<string, unknown>;
      creators?: {
        author?: Array<{ firstName?: string; lastName?: string; literal?: string }>;
        editor?: Array<{ firstName?: string; lastName?: string; literal?: string }>;
      };
    }>;
  };

  try {
    // @retorquere/bibtex-parser
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bibtexParser = require('@retorquere/bibtex-parser');
    parsed = bibtexParser.parse(input, {
      sentenceCase: false,
      errorHandler: (err: { message: string }) => {
        parseErrors.push(err);
      },
    });
  } catch (err) {
    throw new BibtexParseError({
      message: `BibTeX parse failed (structural): ${(err as Error).message}`,
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
    const rawTitle = f('title') ?? '';
    const title = decodeLatex(rawTitle);

    const year = parseYear(f('year'));

    const pages = f('pages')?.replace(/--/g, '-') ?? null;

    const authors = parseAuthors(entry.creators?.author);
    const editors = parseAuthors(entry.creators?.editor);

    const metadata: Partial<PaperMetadata> = {
      id: generatePaperId(doi, arxivId, title || null),
      title,
      authors,
      ...(year != null ? { year } : {}),
      doi,
      arxivId,
      abstract: f('abstract') ? decodeLatex(f('abstract')!) : null,
      paperType,
      source: 'bibtex',
      journal: f('journal') ? decodeLatex(f('journal')!) : f('journaltitle') ? decodeLatex(f('journaltitle')!) : null,
      volume: f('volume'),
      issue: f('number') ?? f('issue'),
      pages,
      publisher: f('publisher'),
      isbn: f('isbn'),
      issn: f('issn'),
      edition: f('edition'),
      editors: editors.length > 0 ? editors : null,
      bookTitle: f('booktitle') ? decodeLatex(f('booktitle')!) : null,
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
