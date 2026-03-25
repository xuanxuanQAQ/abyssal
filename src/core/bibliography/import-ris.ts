// ═══ RIS 导入 ═══
// §2.2: 行级状态机 + 标签映射

import type { PaperMetadata, PaperType } from '../types/paper';
import type { ImportedEntry } from '../types/bibliography';
import { RisParseError } from '../types/errors';
import { generatePaperId, normalizeDoi } from '../search/paper-id';
import { parseAuthorName } from '../search/author-name';

// ─── §2.2.3 TY → PaperType ───

const TY_MAP: Record<string, PaperType> = {
  JOUR: 'journal',
  CONF: 'conference',
  CPAPER: 'conference',
  BOOK: 'book',
  CHAP: 'chapter',
  RPRT: 'preprint',
  UNPB: 'preprint',
  THES: 'preprint',
  GEN: 'unknown',
  MISC: 'unknown',
};

// ─── 行解析正则 ───

const TAG_RE = /^([A-Z][A-Z0-9])\s{2}-\s(.*)$/;

// ─── §2.2 importRis ───

export function importRis(input: string): ImportedEntry[] {
  const lines = input.split(/\r?\n/);
  const results: ImportedEntry[] = [];

  let state: 'idle' | 'reading' = 'idle';
  let currentTags: Array<{ tag: string; value: string }> = [];
  let currentType: PaperType = 'unknown';
  let lastTag: string | null = null;

  function finishRecord() {
    if (currentTags.length === 0) return;

    const get = (tags: string[]): string | null => {
      for (const t of tags) {
        const found = currentTags.find((ct) => ct.tag === t);
        if (found) return found.value;
      }
      return null;
    };

    const getAll = (tags: string[]): string[] =>
      currentTags
        .filter((ct) => tags.includes(ct.tag))
        .map((ct) => ct.value);

    const title = get(['TI', 'T1']);
    const doi = get(['DO']) ? normalizeDoi(get(['DO'])!) : null;
    const yearStr = get(['PY', 'Y1']);
    const year = yearStr ? parseInt(yearStr.replace(/[^0-9]/g, '').slice(0, 4), 10) || 0 : 0;

    const rawAuthors = getAll(['AU', 'A1']);
    const authors = rawAuthors.map((a) =>
      a.includes(',') ? a : parseAuthorName(a),
    );

    const sp = get(['SP']);
    const ep = get(['EP']);
    const pages = sp && ep ? `${sp}-${ep}` : sp ?? null;

    // SN → isbn 或 issn
    const sn = get(['SN']);
    let isbn: string | null = null;
    let issn: string | null = null;
    if (sn) {
      const digits = sn.replace(/[^0-9X]/gi, '');
      if (digits.length >= 10) isbn = sn;
      else issn = sn;
    }

    const metadata: Partial<PaperMetadata> = {
      id: generatePaperId(doi, null, title),
      title: title ?? '',
      authors,
      year,
      doi,
      arxivId: null,
      abstract: get(['AB', 'N2']),
      paperType: currentType,
      source: 'ris',
      journal: get(['JO', 'JF', 'T2']),
      volume: get(['VL']),
      issue: get(['IS']),
      pages,
      publisher: get(['PB']),
      isbn,
      issn,
      url: get(['UR']),
      venue: null,
      edition: null,
      editors: null,
      bookTitle: null,
      series: null,
      citationCount: null,
      pmid: null,
      pmcid: null,
      bibtexKey: null,
      biblioComplete: false,
    };

    results.push({
      originalKey: get(['ID']) ?? `ris_${results.length}`,
      metadata,
      unmappedFields: {},
      sourceFormat: 'ris',
    });
  }

  for (const line of lines) {
    const match = TAG_RE.exec(line);

    if (state === 'idle') {
      if (match && match[1] === 'TY') {
        currentType = TY_MAP[match[2]!.trim()] ?? 'unknown';
        currentTags = [];
        lastTag = 'TY';
        state = 'reading';
      }
      continue;
    }

    // state === 'reading'
    if (match) {
      const [, tag, value] = match;
      if (tag === 'ER') {
        finishRecord();
        state = 'idle';
        currentTags = [];
        lastTag = null;
      } else {
        currentTags.push({ tag: tag!, value: value!.trim() });
        lastTag = tag!;
      }
    } else if (lastTag && line.trim().length > 0) {
      // 续行：拼接到上一字段值
      const lastEntry = currentTags[currentTags.length - 1];
      if (lastEntry) {
        lastEntry.value += ' ' + line.trim();
      }
    }
  }

  // 处理未以 ER 结尾的最后一条记录
  if (state === 'reading') {
    finishRecord();
  }

  return results;
}
